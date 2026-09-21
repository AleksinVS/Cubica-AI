import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ compile: vi.fn(), open: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/compiler-workflow", () => ({ compilePrototypeForEditor: state.compile }));
vi.mock("@/lib/editor-session-store", () => ({ repoRootForSession: state.session }));
vi.mock("@/lib/editor-project-root", () => ({ configuredEditorProjectRoot: () => "/configured" }));
vi.mock("@/lib/editor-repository", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/editor-repository")>(), openAuthoringFile: state.open
}));
import { POST } from "./route";

const body = { gameId: "example", sessionId: "editor-session", filePath: "ui/web.authoring.json",
  sourcePointer: "/root/screens/0/root", prototypePointer: "/_definitions/ui.Example", expectedVersion: "a".repeat(64) };
const request = (value: unknown) => new Request("http://editor.local/api/editor/prototype-preview", { method: "POST", body: JSON.stringify(value) });
beforeEach(() => {
  vi.clearAllMocks();
  state.session.mockResolvedValue({ repoRoot: "/isolated-session" });
  state.open.mockResolvedValue({ text: "authoritative-file", versionHash: body.expectedVersion });
  state.compile.mockResolvedValue({ type: "areaComponent", props: {} });
});

describe("prototype preview endpoint", () => {
  it("uses only the session's authoritative file and compiler output", async () => {
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(state.session).toHaveBeenCalledWith(body.sessionId, body.gameId);
    expect(state.compile).toHaveBeenCalledWith({ ...body, repoRoot: "/isolated-session", text: "authoritative-file" });
    expect(await response.json()).toEqual({ component: { type: "areaComponent", props: {} } });
  });
  it("rejects a stale source before compilation", async () => {
    state.open.mockResolvedValue({ text: "changed", versionHash: "b".repeat(64) });
    expect((await POST(request(body))).status).toBe(409);
    expect(state.compile).not.toHaveBeenCalled();
  });
  it("validates canonical shape and prototype paths before accessing a project", async () => {
    for (const value of [{ ...body, expectedVersion: "stale" }, { ...body, prototypePointer: "/root" }, { ...body, text: "injected" }]) {
      expect((await POST(request(value))).status).toBe(400);
    }
    expect(state.open).not.toHaveBeenCalled();
  });
});
