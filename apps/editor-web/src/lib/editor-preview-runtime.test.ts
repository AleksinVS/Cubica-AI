import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareRuntimeSession } from "./editor-preview-runtime";

afterEach(() => vi.unstubAllGlobals());

describe("editor preview runtime publication", () => {
  it("uses the stable registered owner and starts a paused preview", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ ok: true, contentSourceId: "editor-session-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await prepareRuntimeSession("simple-choice", "http://editor.local", {
      contentSourceId: "editor-session-1",
      contentRoot: "/worktree/candidate",
      pluginBundles: []
    });

    expect(result.ready).toBe(true);
    const url = new URL(result.playerUrl ?? "");
    expect(url.searchParams.get("contentSourceId")).toBe("editor-session-1");
    expect(url.searchParams.get("debugPaused")).toBe("true");
    expect(url.searchParams.get("editorOrigin")).toBe("http://editor.local");
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body as string)).toMatchObject({
      contentSourceId: "editor-session-1", contentRoot: "/worktree/candidate"
    });
  });

  it("fails closed when registration fails", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ error: "registration failed" }, { status: 500 })));

    const result = await prepareRuntimeSession("simple-choice", undefined, {
      contentSourceId: "editor-session-1", contentRoot: "/worktree/candidate", pluginBundles: []
    });
    expect(result.ready).toBe(false);
    expect(result.playerUrl).toBeUndefined();
  });
});
