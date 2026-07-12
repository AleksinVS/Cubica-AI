/**
 * Browser-safe contracts for durable author-version history.
 *
 * This module deliberately contains no Node.js or Git imports. Server route
 * handlers and client components share these DTOs, while commit/ref mechanics
 * remain confined to server-only modules.
 */

export const EDITOR_VERSION_PAGE_LIMIT_MAX = 50;
export const EDITOR_VERSION_COMMENT_MAX_LENGTH = 500;
export const EDITOR_VERSION_CHANGE_FACTS_MAX = 100;
export const EDITOR_VERSION_CHANGE_SUMMARY_MAX_LENGTH = 240;

export type EditorVersionKind = "save" | "restore";
export type EditorVersionChangeKind = "created" | "updated" | "deleted" | "renamed";
export type EditorVersionChangeSource = "user" | "assistant" | "system";

/** A normalized, user-facing explanation of one authoring-file change. */
export interface EditorVersionChangeFact {
  readonly kind: EditorVersionChangeKind;
  readonly filePath: string;
  readonly previousFilePath?: string;
  readonly summary: string;
  readonly source: EditorVersionChangeSource;
}

/** Optional context accepted by Save and persisted with the durable version. */
export interface EditorVersionSaveMetadata {
  readonly authorComment?: string;
  readonly changeFacts?: readonly EditorVersionChangeFact[];
}

/** Compact history row. `versionId` and cursors are opaque to browser code. */
export interface EditorVersionSummary {
  readonly versionId: string;
  readonly kind: EditorVersionKind;
  readonly createdAt: string;
  readonly authorName: string;
  readonly summary: string;
  readonly authorComment?: string;
  readonly changedFileCount: number;
  readonly restoredFromVersionId?: string;
}

/** A changed authoring file shown in version details. */
export interface EditorVersionFileChange {
  readonly kind: EditorVersionChangeKind;
  readonly filePath: string;
  readonly previousFilePath?: string;
  readonly summary: string;
  readonly source: EditorVersionChangeSource;
}

export interface EditorVersionDetails extends EditorVersionSummary {
  readonly changes: readonly EditorVersionFileChange[];
}

export interface EditorVersionDirtySummary {
  readonly isDirty: boolean;
  readonly changedPaths: readonly string[];
  readonly checkedAt: string;
}

/** One newest-first page plus the active session's recovery state. */
export interface EditorVersionPage {
  readonly versions: readonly EditorVersionSummary[];
  readonly nextCursor?: string;
  readonly currentVersionId: string | null;
  readonly dirtySummary: EditorVersionDirtySummary;
}

export interface EditorVersionRestoreRequest {
  readonly sessionId: string;
  readonly versionId: string;
  readonly expectedHead: string | null;
}

export interface EditorVersionRestoreResult {
  readonly version: EditorVersionSummary;
  readonly currentVersionId: string;
  readonly restoredVersionId: string;
  readonly changedPaths: readonly string[];
  readonly sessionMetadataSynchronized: boolean;
  readonly sessionMetadataSyncCode?: "metadata_sync_failed";
}

export type EditorVersionErrorCode =
  | "invalid_request"
  | "invalid_cursor"
  | "session_not_found"
  | "version_not_found"
  | "version_conflict"
  | "session_dirty"
  | "session_incompatible";

export interface EditorVersionErrorResponse {
  readonly error: string;
  readonly code: EditorVersionErrorCode;
}
