import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorMutationRequest } from "@cubica/editor-engine";

import { postEditorMutation } from "./editor-mutation-client";

const base = {
  gameId: "simple-choice",
  sessionId: "session-1",
  activeFilePath: "games/simple-choice/authoring/game.json",
  activeDocument: { text: "{}", versionHash: "a".repeat(64) },
  changeSet: { id: "change-1", summary: "Change label", jsonPatches: [] }
};

afterEach(() => vi.unstubAllGlobals());

describe("editor mutation client", () => {
  it.each(["prepare", "direct", "confirm"] as const)("sends %s through the same server mutation route", async (action) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, status: action === "prepare" ? "prepared" : action === "confirm" ? "confirmed" : "direct" })
    });
    vi.stubGlobal("fetch", fetchMock);
    const request = { ...base, action, ...(action === "confirm" ? { effectDigest: "b".repeat(64) } : {}) } as EditorMutationRequest;

    await postEditorMutation(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/editor/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request)
    });
  });

  it("rejects stale and invalid responses without a client write fallback", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "Prepared effect is stale." })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(postEditorMutation({ ...base, action: "confirm", effectDigest: "b".repeat(64) } as EditorMutationRequest))
      .rejects.toThrow("Prepared effect is stale.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
