import { describe, expect, it } from "vitest";
import { createPreviewPrototypeCommandQueue } from "./preview-prototype-command-queue";

describe("prototype preview command order", () => {
  it("waits for a deferred old show before clearing, then allows a newer show", async () => {
    const queue = createPreviewPrototypeCommandQueue();
    const events: string[] = [];
    let releaseOld!: () => void;
    const oldResponse = new Promise<void>((resolve) => { releaseOld = resolve; });
    const old = queue.enqueue(async () => { events.push("old show"); await oldResponse; });
    const clear = queue.enqueue(async () => { events.push("clear old"); });
    const newer = queue.enqueue(async () => { events.push("new show"); });
    await Promise.resolve();
    expect(events).toEqual(["old show"]);
    releaseOld();
    await Promise.all([old, clear, newer]);
    expect(events).toEqual(["old show", "clear old", "new show"]);
  });
});
