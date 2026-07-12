/** Controller tests for pagination helpers and the restore/reload handshake. */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EditorVersionSummary } from "@/lib/editor-version-contracts";
import { EditorVersionApiError } from "./api-client.ts";
import { historyErrorMessage, mergeVersions, useEditorVersionHistory } from "./use-editor-version-history.ts";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const version = (versionId: string): EditorVersionSummary => ({
  versionId,
  kind: "save",
  createdAt: "2026-07-11T09:00:00.000Z",
  authorName: "Автор",
  summary: versionId,
  changedFileCount: 1
});

describe("version history helpers", () => {
  it("keeps newest-first page order and removes overlapping cursor rows", () => {
    expect(mergeVersions([version("v3"), version("v2")], [version("v2"), version("v1")]).map((item) => item.versionId))
      .toEqual(["v3", "v2", "v1"]);
  });

  it("maps expected failures to Russian product copy", () => {
    const message = historyErrorMessage(new EditorVersionApiError("raw", "version_conflict", 409));
    expect(message).toContain("другой вкладке");
    expect(message).not.toContain("raw");
  });

  it("restores against the loaded head, calls the workspace reload, then refreshes history", async () => {
    const cleanPage = { versions: [version("head")], currentVersionId: "head", dirtySummary: { isDirty: false, changedPaths: [], checkedAt: "now" } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(cleanPage)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: version("restored"), currentVersionId: "restored", restoredVersionId: "old", changedPaths: ["games/demo/authoring/game.authoring.json"] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...cleanPage, versions: [version("restored"), version("head")], currentVersionId: "restored" })));
    vi.stubGlobal("fetch", fetchMock);
    const onRestored = vi.fn();
    let controller: ReturnType<typeof useEditorVersionHistory> | undefined;
    function Harness() {
      controller = useEditorVersionHistory({ sessionId: "session", initialCurrentVersionId: "head", onRestored });
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(Harness));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(controller?.currentVersionId).toBe("head");
    await act(async () => {
      await controller?.restore("old");
    });
    expect(onRestored).toHaveBeenCalledOnce();
    const restoreBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
    expect(restoreBody).toMatchObject({ versionId: "old", expectedHead: "head" });
    expect(controller?.currentVersionId).toBe("restored");
    await act(async () => root.unmount());
  });
});
