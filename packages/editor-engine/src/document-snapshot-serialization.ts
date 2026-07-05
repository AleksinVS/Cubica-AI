/**
 * JSON-safe (de)serialization of DocumentStore snapshots for the Level-2 disk
 * warm-start cache (ADR-057 §4.13 "Уровень 2"; editor-preview-first-ux §10;
 * design-spec §2.6).
 *
 * WHAT THIS IS. A `DocumentSnapshot` (parse tree + text location map + syntax
 * diagnostics) is expensive to build — building the location map alone is ~98%
 * of the parse cost (profiling baseline §9). To reuse it across editor loads,
 * the snapshot must survive a round-trip through disk as plain JSON. The only
 * non-JSON part of a snapshot is `locationMap`, which is an object with methods
 * backed by a `Map`; everything it holds is already JSON-safe data
 * (`TextLocationEntry[]`), so serialization just captures that flat entry list
 * and revival rebuilds the map from it.
 *
 * INVARIANTS (ADR-057 §5). This module is framework-agnostic and has NO
 * Node.js dependencies (no `node:*`, no filesystem) — the disk I/O lives in the
 * editor-web server library. The cache is one-shot and NEVER a source of truth:
 * `reviveDocumentSnapshot` is STRICT — any format-version mismatch, missing
 * field, or wrong-shaped payload returns `null`, which the caller treats as a
 * silent miss and rebuilds. A bumped {@link DOCUMENT_SNAPSHOT_CACHE_FORMAT_VERSION}
 * therefore invalidates every previously written entry, because an old-shaped
 * file can never be read back.
 */
import { createTextLocationMapFromEntries } from "./document-store.ts";
import type {
  DocumentDiagnostic,
  DocumentSnapshot,
  JsonValue,
  TextLocationEntry
} from "./types.ts";

/**
 * Version of the serialized snapshot envelope. Bump this whenever the snapshot
 * shape or the parser that produces location entries changes in a way that
 * makes previously cached payloads wrong. It is part of every disk-cache key AND
 * checked on revive, so a stale-shaped file is never read.
 */
export const DOCUMENT_SNAPSHOT_CACHE_FORMAT_VERSION = 1;

/** JSON-safe body of a serialized snapshot. */
export interface SerializedDocumentSnapshot {
  readonly filePath: string;
  readonly text: string;
  /**
   * Discriminates a valid `null` document (`hasJson: true`, `json: null`) from a
   * failed parse (`hasJson: false`, `json` absent). JSON has no `undefined`, so
   * this flag is what makes the two cases distinguishable on revive.
   */
  readonly hasJson: boolean;
  readonly json?: JsonValue;
  readonly diagnostics: readonly DocumentDiagnostic[];
  readonly selectedPointer?: string;
  /** Exactly the list `TextLocationMap.entries()` returned when the snapshot was built. */
  readonly locationEntries: readonly TextLocationEntry[];
}

/** Versioned envelope written to disk; the version guards a strict revive. */
export interface SerializedDocumentSnapshotEnvelope {
  readonly formatVersion: number;
  /** Optional editor-engine build identifier, informational only. */
  readonly engineVersion?: string;
  readonly payload: SerializedDocumentSnapshot;
}

/** Serializes a snapshot into a versioned, JSON-safe envelope. Pure and deterministic. */
export function serializeDocumentSnapshot(
  snapshot: DocumentSnapshot,
  engineVersion?: string
): SerializedDocumentSnapshotEnvelope {
  const payload: SerializedDocumentSnapshot = {
    filePath: snapshot.filePath,
    text: snapshot.text,
    hasJson: snapshot.json !== undefined,
    ...(snapshot.json !== undefined ? { json: snapshot.json } : {}),
    diagnostics: snapshot.diagnostics,
    ...(snapshot.selectedPointer !== undefined ? { selectedPointer: snapshot.selectedPointer } : {}),
    locationEntries: snapshot.locationMap.entries()
  };

  return {
    formatVersion: DOCUMENT_SNAPSHOT_CACHE_FORMAT_VERSION,
    ...(engineVersion !== undefined ? { engineVersion } : {}),
    payload
  };
}

/**
 * Strictly revives a snapshot from an unknown parsed value.
 *
 * Returns `null` on ANY mismatch (wrong/absent format version, non-object,
 * missing or wrong-typed fields). Returning `null` — never throwing — is what
 * lets the cache stay one-shot: a foreign, older, or corrupt file simply becomes
 * a rebuild.
 */
export function reviveDocumentSnapshot(value: unknown): DocumentSnapshot | null {
  if (!isRecord(value) || value.formatVersion !== DOCUMENT_SNAPSHOT_CACHE_FORMAT_VERSION) {
    return null;
  }

  const payload = value.payload;
  if (
    !isRecord(payload) ||
    typeof payload.filePath !== "string" ||
    typeof payload.text !== "string" ||
    typeof payload.hasJson !== "boolean" ||
    !Array.isArray(payload.diagnostics) ||
    !Array.isArray(payload.locationEntries) ||
    (payload.selectedPointer !== undefined && typeof payload.selectedPointer !== "string")
  ) {
    return null;
  }

  return {
    filePath: payload.filePath,
    text: payload.text,
    json: payload.hasJson ? (payload.json as JsonValue) : undefined,
    diagnostics: payload.diagnostics as readonly DocumentDiagnostic[],
    selectedPointer: payload.selectedPointer as string | undefined,
    locationMap: createTextLocationMapFromEntries(payload.locationEntries as readonly TextLocationEntry[])
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
