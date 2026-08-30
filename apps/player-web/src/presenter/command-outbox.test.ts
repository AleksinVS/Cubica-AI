/** Focused contract tests for client command identity and durable retries. */

import { afterEach, describe, expect, it } from "vitest";
import {
  clearPendingRuntimeCommand,
  generateClientCommandId,
  loadPendingRuntimeCommand,
  savePendingRuntimeCommand
} from "./command-outbox";

afterEach(() => {
  window.localStorage.clear();
});

describe("command outbox", () => {
  it("encodes exactly sixteen random bytes as cli_ base64url without padding", () => {
    const bytes = Uint8Array.from([
      0, 1, 2, 3, 4, 5, 6, 7,
      8, 9, 10, 11, 12, 13, 14, 255
    ]);
    const randomSource = {
      getRandomValues<T extends ArrayBufferView | null>(target: T): T {
        if (!(target instanceof Uint8Array)) throw new Error("Expected Uint8Array");
        target.set(bytes);
        return target;
      }
    };

    const commandId = generateClientCommandId(randomSource);

    expect(commandId).toBe("cli_AAECAwQFBgcICQoLDA0O_w");
    expect(commandId).toMatch(/^cli_[A-Za-z0-9_-]{22}$/u);
    expect(commandId).not.toContain("=");
  });

  it("persists and removes one immutable pending envelope per session", () => {
    const pending = {
      endpoint: "action" as const,
      envelope: {
        sessionId: "session-1",
        actionId: "card.draw",
        commandId: "cli_AAAAAAAAAAAAAAAAAAAAAA" as const,
        expectedStateVersion: 7,
        params: { deckId: "events" }
      }
    };

    savePendingRuntimeCommand(pending);
    expect(loadPendingRuntimeCommand("session-1")).toEqual(pending);

    clearPendingRuntimeCommand("session-1");
    expect(loadPendingRuntimeCommand("session-1")).toBeNull();
  });
});
