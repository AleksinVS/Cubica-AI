/** Transport tests for the browser-safe history API client. */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EditorVersionApiError,
  fetchEditorVersionDetails,
  fetchEditorVersionPage,
  restoreEditorVersion
} from "./api-client.ts";

afterEach(() => vi.unstubAllGlobals());

describe("history api client", () => {
  it("encodes opaque page and detail parameters", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ versions: [], currentVersionId: null, dirtySummary: { isDirty: false, changedPaths: [], checkedAt: "now" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ versionId: "v/1", kind: "save", createdAt: "now", authorName: "A", summary: "S", changedFileCount: 0, changes: [] })));
    vi.stubGlobal("fetch", fetchMock);
    await fetchEditorVersionPage({ sessionId: "session 1", cursor: "next/2", limit: 20 });
    await fetchEditorVersionDetails("session 1", "v/1");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("sessionId=session+1");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("cursor=next%2F2");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("versionId=v%2F1");
  });

  it("posts restore with expected current version", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      version: { versionId: "new", kind: "restore", createdAt: "now", authorName: "A", summary: "Возврат", changedFileCount: 1 },
      currentVersionId: "new",
      restoredVersionId: "old",
      changedPaths: ["games/demo/authoring/game.authoring.json"]
    })));
    vi.stubGlobal("fetch", fetchMock);
    await restoreEditorVersion({ sessionId: "s", versionId: "old", expectedHead: "head" });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ sessionId: "s", versionId: "old", expectedHead: "head" });
  });

  it("preserves stable error codes without exposing response internals", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "changed", code: "version_conflict" }), { status: 409 })));
    const caught = await fetchEditorVersionPage({ sessionId: "s" }).catch((error) => error);
    expect(caught).toBeInstanceOf(EditorVersionApiError);
    expect(caught.code).toBe("version_conflict");
    expect(caught.status).toBe(409);
  });
});
