/** HTTP contract tests for session-backed durable Save. */
import { NextRequest } from "next/server";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/editor-session-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/editor-session-store")>();
  return {
    ...actual,
    repoRootForSession: vi.fn(),
    markEditorSessionSaved: vi.fn(),
    withEditorSessionMutationLease: vi.fn((_sessionId: string, _operation: string, callback: () => Promise<unknown>) => callback())
  };
});

vi.mock("@/lib/editor-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/editor-repository")>();
  return {
    ...actual,
    saveAuthoringFile: vi.fn()
  };
});

vi.mock("@/lib/project-plugin-validation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/project-plugin-validation")>();
  return {
    ...actual,
    validateAndBundleProjectPlugins: vi.fn()
  };
});

vi.mock("@/lib/project-git-workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/project-git-workspace")>();
  return {
    ...actual,
    allowedSavePathsForGame: vi.fn(),
    saveProjectGitSession: vi.fn()
  };
});

import {
  markEditorSessionSaved,
  repoRootForSession,
  withEditorSessionMutationLease
} from "@/lib/editor-session-store";
import { saveAuthoringFile } from "@/lib/editor-repository";
import { validateAndBundleProjectPlugins } from "@/lib/project-plugin-validation";
import { allowedSavePathsForGame, saveProjectGitSession } from "@/lib/project-git-workspace";

import { PUT } from "./route";

const session = {
  sessionId: "neutral-session",
  gameId: "neutral-game",
  userId: "Neutral Author",
  projectRoot: "/tmp/neutral-project",
  worktreePath: "/tmp/neutral-worktree",
  currentVersionId: "b".repeat(40),
  branchName: "editor/session/neutral-session",
  baseCommit: "a".repeat(40),
  schemaVersion: 3 as const,
  projectId: "/tmp/neutral-project",
  platformReleaseId: "test",
  pluginApiVersion: "1.0",
  status: "saved" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
  dirtySummary: { isDirty: false, changedPaths: [], checkedAt: "2026-01-01T00:00:00.000Z" }
};

beforeEach(() => {
  vi.mocked(repoRootForSession).mockReset().mockResolvedValue({ repoRoot: "/tmp/neutral-worktree", session });
  vi.mocked(saveAuthoringFile).mockReset().mockResolvedValue({
    gameId: session.gameId,
    filePath: "game.authoring.json",
    text: "{}\n",
    size: 3,
    previousVersionHash: "a".repeat(40),
    versionHash: "b".repeat(64)
  });
  vi.mocked(validateAndBundleProjectPlugins).mockReset().mockResolvedValue({
    ok: true,
    diagnostics: [],
    playerWebBundles: []
  });
  vi.mocked(allowedSavePathsForGame).mockReset().mockReturnValue(["games/neutral-game/authoring/game.authoring.json"]);
  vi.mocked(saveProjectGitSession).mockReset().mockResolvedValue({
    committed: true,
    commitHash: "c".repeat(40),
    versionId: "d".repeat(40),
    version: {
      versionId: "d".repeat(40),
      kind: "save",
      createdAt: "2026-01-01T00:00:00.000Z",
      authorName: session.userId,
      summary: "Saved",
      changedFileCount: 1
    },
    changedPaths: ["games/neutral-game/authoring/game.authoring.json"]
  });
  vi.mocked(markEditorSessionSaved).mockReset().mockResolvedValue(session);
  vi.mocked(withEditorSessionMutationLease).mockReset().mockImplementation((_sessionId, _operation, callback) => callback());
});

describe("editor file Save route", () => {
  it("rejects a write without sessionId before touching the repository", async () => {
    const response = await PUT(new NextRequest("http://localhost/api/editor/file", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        gameId: "neutral-game",
        filePath: "game.authoring.json",
        text: "{}\n",
        versionHash: "a".repeat(64)
      })
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("sessionId")
    });
  });

  it("returns metadata sync diagnostic code when session metadata cannot be updated", async () => {
    vi.mocked(markEditorSessionSaved).mockRejectedValue(new Error("metadata write blocked"));

    const response = await PUT(new NextRequest("http://localhost/api/editor/file", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        gameId: session.gameId,
        filePath: "game.authoring.json",
        text: "{}\n",
        versionHash: "a".repeat(40),
        sessionId: session.sessionId,
        expectedHead: session.currentVersionId
      })
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sessionMetadataSynchronized: false,
      sessionMetadataSyncCode: "metadata_sync_failed"
    });
  });
});
