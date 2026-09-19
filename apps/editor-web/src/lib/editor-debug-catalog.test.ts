import { beforeEach, expect, it } from "vitest";
import { debugCatalogKey, forgetDebugOrigin, readDebugOrigins, rememberDebugOrigin } from "./editor-debug-catalog";
beforeEach(() => localStorage.clear());
it("keeps nonsecret discovery IDs across reloads without TTL or rebuild eviction", () => {
  const key = debugCatalogKey("neutral-game", "editor-1");
  rememberDebugOrigin(key, "old-session"); rememberDebugOrigin(key, "new-session"); rememberDebugOrigin(key, "old-session");
  expect(readDebugOrigins(key)).toEqual(["old-session", "new-session"]);
  expect(readDebugOrigins(debugCatalogKey("other-game", "editor-1"))).toEqual([]);
  forgetDebugOrigin(key, "old-session"); expect(readDebugOrigins(key)).toEqual(["new-session"]);
});
it("does not overwrite a corrupt catalog or hide a storage failure", () => {
  localStorage.setItem("key", '[{"credential":"invalid"}]');
  expect(() => rememberDebugOrigin("key", "session")).toThrow(); expect(localStorage.getItem("key")).toContain("invalid");
  const storage = { getItem: () => null, setItem: () => { throw new Error("quota"); } } as unknown as Storage;
  expect(() => rememberDebugOrigin("key", "session", storage)).toThrow("quota");
});
