import { describe, expect, it } from "vitest";
import { matchSavedAuthoringScope, type SaveAuthoringScope } from "./save-authoring-state";
import type { CurrentDocument, SavedAuthoringFileDocument } from "./types";

const request: SaveAuthoringScope = {
  gameId: "simple-choice", filePath: "game.authoring.json", versionHash: "before", sessionId: "session-a", loadEpoch: 3
};
const document: CurrentDocument = {
  source: "repository", gameId: request.gameId, filePath: request.filePath, versionHash: request.versionHash
};
const saved: SavedAuthoringFileDocument = {
  gameId: request.gameId, filePath: request.filePath, versionHash: "after",
  size: 18, text: "submitted durable text", sessionId: request.sessionId
};
const current = { document, sessionId: request.sessionId, loadEpoch: request.loadEpoch };

describe("durable Save scope", () => {
  it("accepts the matching response and distinguishes a newer source revision", () => {
    expect(matchSavedAuthoringScope(current, request, saved)).toBe("current");
    expect(matchSavedAuthoringScope(current, request)).toBe("current");
    expect(matchSavedAuthoringScope({
      ...current, document: { ...document, versionHash: "newer edit" }
    }, request, saved)).toBe("superseded");
  });

  it("rejects a response after game, file, session, or load changes", () => {
    expect(matchSavedAuthoringScope({
      ...current, document: { ...document, gameId: "antarctica" }
    }, request, saved)).toBe("stale");
    expect(matchSavedAuthoringScope({
      ...current, document: { ...document, filePath: "ui/web.authoring.json" }
    }, request, saved)).toBe("stale");
    expect(matchSavedAuthoringScope({ ...current, sessionId: "session-b" }, request, saved)).toBe("stale");
    expect(matchSavedAuthoringScope({ ...current, loadEpoch: 4 }, request, saved)).toBe("stale");
    expect(matchSavedAuthoringScope(current, request, { ...saved, gameId: "antarctica" })).toBe("stale");
  });
});
