/** HTTP-boundary tests for durable editor history. */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/editor-session-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/editor-session-store")>();
  return {
    ...actual,
    touchEditorSession: vi.fn(),
    markEditorSessionSaved: vi.fn(),
    withEditorSessionMutationLease: vi.fn((_sessionId: string, _operation: string, callback: () => Promise<unknown>) => callback()),
    evaluateEditorSessionCompatibility: vi.fn(() => ({ ok: true }))
  };
});

vi.mock("@/lib/project-git-workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/project-git-workspace")>();
  return {
    ...actual,
    listProjectVersionHistory: vi.fn(),
    readProjectVersionDetails: vi.fn(),
    restoreDurableProjectVersion: vi.fn()
  };
});

import {
  evaluateEditorSessionCompatibility,
  markEditorSessionSaved,
  touchEditorSession
} from "@/lib/editor-session-store";
import {
  listProjectVersionHistory,
  restoreDurableProjectVersion
} from "@/lib/project-git-workspace";
import { EditorRepositoryError } from "@/lib/editor-repository";
import { GET, POST } from "./route";

const session = {
  sessionId: "neutral-session",
  projectRoot: "/tmp/neutral-project",
  worktreePath: "/tmp/neutral-worktree",
  branchName: "editor/session/neutral-session",
  baseCommit: "a".repeat(40),
  currentVersionId: "b".repeat(40),
  schemaVersion: 3 as const,
  userId: "Neutral Author",
  projectId: "/tmp/neutral-project",
  gameId: "neutral-game",
  platformReleaseId: "test",
  pluginApiVersion: "1.0",
  status: "saved" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
  dirtySummary: { isDirty: false, changedPaths: [], checkedAt: "2026-01-01T00:00:00.000Z" }
};

describe("editor history route", () => {
  beforeEach(() => {
    vi.mocked(touchEditorSession).mockReset().mockResolvedValue(session);
    vi.mocked(listProjectVersionHistory).mockReset().mockResolvedValue({
      versions: [],
      currentVersionId: session.currentVersionId!
    });
    vi.mocked(restoreDurableProjectVersion).mockReset();
    vi.mocked(markEditorSessionSaved).mockReset().mockResolvedValue(session);
    vi.mocked(evaluateEditorSessionCompatibility).mockReset().mockReturnValue({
      ok: true,
      requiresUpgrade: false,
      diagnostics: [],
      current: { platformReleaseId: "test", pluginApiVersion: "1.0" },
      session: { platformReleaseId: "test", pluginApiVersion: "1.0" }
    });
  });

  it("returns a dynamic no-store page with session recovery state", async () => {
    const response = await GET(new NextRequest("http://localhost/api/editor/history?sessionId=neutral-session"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      versions: [],
      currentVersionId: session.currentVersionId,
      dirtySummary: session.dirtySummary
    });
  });

  it("returns a stable 409 code before a dirty restore changes files", async () => {
    vi.mocked(touchEditorSession).mockResolvedValue({
      ...session,
      status: "dirty",
      dirtySummary: { ...session.dirtySummary, isDirty: true, changedPaths: ["games/neutral-game/authoring/game.authoring.json"] }
    });
    const response = await POST(new Request("http://localhost/api/editor/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: session.sessionId,
        versionId: "c".repeat(40),
        expectedHead: session.currentVersionId
      })
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "session_dirty" });
    expect(restoreDurableProjectVersion).not.toHaveBeenCalled();
  });

  it("rejects malformed restore input with a stable 400 response", async () => {
    const response = await POST(new Request("http://localhost/api/editor/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: session.sessionId })
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_request" });
  });

  it("accepts null expectedHead as a valid restore request", async () => {
    const restoredVersionId = "d".repeat(40);
    vi.mocked(restoreDurableProjectVersion).mockResolvedValue({
      committed: true,
      commitHash: "e".repeat(40),
      versionId: restoredVersionId,
      version: {
        versionId: restoredVersionId,
        kind: "restore",
        createdAt: "2026-01-02T00:00:00.000Z",
        authorName: "Neutral Author",
        summary: "Восстановлена авторская версия",
        changedFileCount: 1,
        restoredFromVersionId: "c".repeat(40)
      },
      changedPaths: ["games/neutral-game/authoring/game.authoring.json"]
    });

    const response = await POST(new Request("http://localhost/api/editor/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: session.sessionId,
        versionId: "c".repeat(40),
        expectedHead: null
      })
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      currentVersionId: restoredVersionId,
      sessionMetadataSynchronized: true
    });
    expect(body).not.toHaveProperty("sessionMetadataSyncCode");
    expect(restoreDurableProjectVersion).toHaveBeenCalledWith(expect.objectContaining({
      expectedHead: null
    }));
  });

  it("returns a committed restore when only the post-CAS metadata write fails", async () => {
    const restoredVersionId = "d".repeat(40);
    vi.mocked(restoreDurableProjectVersion).mockResolvedValue({
      committed: true,
      commitHash: "e".repeat(40),
      versionId: restoredVersionId,
      version: {
        versionId: restoredVersionId,
        kind: "restore",
        createdAt: "2026-01-02T00:00:00.000Z",
        authorName: "Neutral Author",
        summary: "Восстановлена авторская версия",
        changedFileCount: 1,
        restoredFromVersionId: "c".repeat(40)
      },
      changedPaths: ["games/neutral-game/authoring/game.authoring.json"]
    });
    vi.mocked(markEditorSessionSaved).mockRejectedValue(new Error("metadata disk failure"));

    const response = await POST(new Request("http://localhost/api/editor/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: session.sessionId,
        versionId: "c".repeat(40),
        expectedHead: session.currentVersionId
      })
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      currentVersionId: restoredVersionId,
      sessionMetadataSynchronized: false,
      sessionMetadataSyncCode: "metadata_sync_failed"
    });
  });

  it("does not expose repository command details from an internal failure", async () => {
    vi.mocked(touchEditorSession).mockRejectedValue(new EditorRepositoryError(
      "fatal: command failed in /private/repository with secret stderr",
      500
    ));
    const response = await GET(new NextRequest("http://localhost/api/editor/history?sessionId=neutral-session"));
    const body = await response.json() as { readonly error: string };
    expect(response.status).toBe(500);
    expect(body.error).toBe("Unexpected editor history failure.");
    expect(JSON.stringify(body)).not.toContain("private");
    expect(JSON.stringify(body)).not.toContain("stderr");
  });
});
