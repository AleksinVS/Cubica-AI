/** HTTP contract tests for session-backed durable Save. */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { PUT } from "./route";

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
});
