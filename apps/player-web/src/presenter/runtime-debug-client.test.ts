import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorDebugBridgeRequest } from "@cubica/contracts-session";
import { runEditorDebugCommand } from "./runtime-debug-client";

afterEach(() => vi.unstubAllGlobals());
const command: EditorDebugBridgeRequest = {
  source: "cubica-editor-web", type: "debugSession", protocolVersion: 1,
  requestId: "request", sessionId: "preview", operation: "pause", payload: { expectedStateVersion: 2 }
};
describe("debug command client", () => {
  it("reports paused only from a schema-valid server acknowledgment", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      sessionId: "preview", paused: true, version: { sessionId: "preview", stateVersion: 3, lastEventSequence: 0 }
    }))).mockResolvedValueOnce(new Response(JSON.stringify({ paused: true })));
    vi.stubGlobal("fetch", fetchMock);
    const restore = vi.fn();
    const success = await runEditorDebugCommand(command, restore);
    expect(success.ok).toBe(true);
    expect(fetchMock.mock.calls[0][1].body).toBe('{"expectedStateVersion":2}');
    expect(await runEditorDebugCommand(command, restore)).toMatchObject({ ok: false });
    expect(restore).not.toHaveBeenCalled();
  });

  it("does not disclose upstream secret error details or falsely confirm a conflict", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"secret-state-detail"}', { status: 409 })));
    const result = await runEditorDebugCommand(command, vi.fn());
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret-state-detail");
    expect(JSON.stringify(result)).not.toContain('"paused":true');
  });
});
