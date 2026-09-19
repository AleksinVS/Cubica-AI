import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorDebugChannel } from "./editor-debug-channel";
const channels: EditorDebugChannel[] = [];
afterEach(() => { channels.forEach(channel => channel.close()); channels.length = 0; vi.useRealTimers(); });
function setup(timeout = 100) {
  const postMessage = vi.fn(); const frame = { postMessage } as unknown as Window;
  const channel = new EditorDebugChannel(() => frame, "https://player.test", timeout); channels.push(channel);
  function reply(data: unknown, source = frame, origin = "https://player.test") {
    window.dispatchEvent(new MessageEvent("message", { data, source, origin }));
  }
  function response(overrides = {}) {
    const command = postMessage.mock.calls.at(-1)![0];
    return { source: "cubica-player-web", type: "debugSessionResult", protocolVersion: 1,
      requestId: command.requestId, sessionId: "session-1", ok: true, operation: "status",
      data: { sessionId: "session-1", paused: true, version: { sessionId: "session-1", stateVersion: 4, lastEventSequence: 0 } }, ...overrides };
  }
  return { channel, postMessage, frame, reply, response };
}
describe("protected debug frame channel", () => {
  it("ignores wrong frame, origin, request, operation and inner session before accepting acknowledgement", async () => {
    const s = setup(); const request = s.channel.request({ operation: "status", sessionId: "session-1" });
    const accepted = vi.fn(); void request.then(accepted, () => {}); const good = s.response();
    s.reply(good, {} as Window); s.reply(good, s.frame, "https://other.test");
    s.reply(s.response({ requestId: "wrong" })); s.reply(s.response({ operation: "pause" }));
    s.reply(s.response({ data: { ...good.data, sessionId: "session-2" } }));
    await Promise.resolve(); expect(accepted).not.toHaveBeenCalled();
    s.reply(good); await expect(request).resolves.toMatchObject({ data: { paused: true } });
  });
  it("rejects outstanding work on frame replacement", async () => {
    const s = setup(); const request = s.channel.request({ operation: "status", sessionId: "session-1" });
    const rejected = expect(request).rejects.toThrow("изменилось"); s.channel.close(); await rejected;
  });
  it("times out without optimistic success and handles failed postMessage", async () => {
    vi.useFakeTimers(); const s = setup(); const request = s.channel.request({ operation: "status", sessionId: "session-1" });
    const rejected = expect(request).rejects.toThrow("не подтвердил"); await vi.advanceTimersByTimeAsync(101); await rejected;
    s.postMessage.mockImplementation(() => { throw new Error("detached"); });
    await expect(s.channel.request({ operation: "status", sessionId: "session-1" })).rejects.toThrow("отправить");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("restores only into a new paused session with consistent identity", async () => {
    const s = setup(); const request = s.channel.request({ operation: "restore", sessionId: "session-1", checkpointId: "checkpoint-1" });
    const accepted = vi.fn(); void request.then(accepted, () => {}); s.reply(s.response({ operation: "restore" }));
    await Promise.resolve(); expect(accepted).not.toHaveBeenCalled();
    s.reply(s.response({ operation: "restore", data: { sessionId: "session-2", paused: true, version: { sessionId: "session-2", stateVersion: 1, lastEventSequence: 0 } } }));
    await expect(request).resolves.toMatchObject({ data: { sessionId: "session-2" } });
  });
});
