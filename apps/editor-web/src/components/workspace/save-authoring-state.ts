import type { CurrentDocument, SavedAuthoringFileDocument } from "./types";

export interface SaveAuthoringScope {
  readonly gameId: string;
  readonly filePath: string;
  readonly versionHash: string;
  readonly sessionId: string | undefined;
  readonly loadEpoch: number;
}

/** Distinguishes a late Save for another workspace from one superseded in this workspace. */
export function matchSavedAuthoringScope(
  current: { readonly document: CurrentDocument; readonly sessionId: string | undefined; readonly loadEpoch: number },
  request: SaveAuthoringScope,
  saved?: SavedAuthoringFileDocument
): "current" | "superseded" | "stale" {
  if (current.document.source !== "repository" ||
      current.document.gameId !== request.gameId ||
      current.document.filePath !== request.filePath ||
      current.sessionId !== request.sessionId ||
      current.loadEpoch !== request.loadEpoch ||
      (saved !== undefined && (
        saved.gameId !== request.gameId ||
        saved.filePath !== request.filePath ||
        (saved.sessionId !== undefined && saved.sessionId !== request.sessionId)))) {
    return "stale";
  }
  return current.document.versionHash === request.versionHash ? "current" : "superseded";
}
