import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  lease: vi.fn(),
  session: vi.fn(),
  open: vi.fn(),
  save: vi.fn()
}));

vi.mock("@/lib/editor-repository", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/editor-repository")>(),
  openEditorLayout: state.open,
  saveEditorLayout: state.save
}));
vi.mock("@/lib/editor-session-store", () => ({
  repoRootForSession: state.session,
  touchEditorSession: vi.fn(),
  withEditorSessionMutationLease: state.lease
}));

import { GET, PUT } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  state.session.mockResolvedValue({ session: { sessionId: "editor-session-1" }, repoRoot: "/session/worktree" });
  state.lease.mockImplementation(async (_sessionId, _operation, callback) => callback());
  state.open.mockResolvedValue({ layout: { version: 1, nodes: {} } });
  state.save.mockResolvedValue({ versionHash: "new-hash" });
});

describe("layout session boundary", () => {
  it("rejects reads without an active session worktree", async () => {
    const missing = await GET(new NextRequest("http://editor/api/editor/layout?gameId=simple-choice&filePath=game.authoring.json"));
    expect(missing.status).toBe(400);
    state.session.mockResolvedValueOnce({});
    const inactive = await GET(new NextRequest("http://editor/api/editor/layout?gameId=simple-choice&filePath=game.authoring.json&sessionId=editor-session-1"));
    expect(inactive.status).toBe(400);
    expect(state.open).not.toHaveBeenCalled();
  });

  it("requires versionHash and sessionId before any write", async () => {
    const response = await PUT(new NextRequest("http://editor/api/editor/layout", {
      method: "PUT",
      body: JSON.stringify({ gameId: "simple-choice", filePath: "game.authoring.json", layout: { version: 1, nodes: {} } })
    }));
    expect(response.status).toBe(400);
    expect(state.lease).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
  });

  it("uses the shared session lease and session worktree for a versioned write", async () => {
    const response = await PUT(new NextRequest("http://editor/api/editor/layout", {
      method: "PUT",
      body: JSON.stringify({
        gameId: "simple-choice", filePath: "game.authoring.json", sessionId: "editor-session-1",
        versionHash: "old-hash", layout: { version: 1, nodes: {} }
      })
    }));
    expect(response.status).toBe(200);
    expect(state.lease).toHaveBeenCalledWith("editor-session-1", "layout-save", expect.any(Function));
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ repoRoot: "/session/worktree", versionHash: "old-hash" }));
  });
});
