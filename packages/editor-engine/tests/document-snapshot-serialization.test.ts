/**
 * Round-trip and strict-revive tests for the Level-2 disk-cache serialization
 * layer (ADR-057 §4.13 "Уровень 2"; editor-preview-first-ux §10).
 *
 * These prove the two contracts the disk cache relies on:
 *  1. serialize -> revive reproduces an observationally identical snapshot;
 *  2. revive is STRICT: garbage or a foreign/older format yields `null` (a miss),
 *     never a throw and never a partly-populated snapshot.
 */
import { describe, expect, it } from "vitest";

import { createDocumentStore } from "../src/document-store.ts";
import {
  DOCUMENT_SNAPSHOT_CACHE_FORMAT_VERSION,
  reviveDocumentSnapshot,
  serializeDocumentSnapshot
} from "../src/document-snapshot-serialization.ts";
import type { DocumentSnapshot } from "../src/types.ts";

const authoringText = `${JSON.stringify(
  {
    _type: "game.manifest",
    id: "sample",
    _label: "Sample",
    root: {
      actions: [
        { id: "start", _label: "Start", displayName: "Start here" },
        { id: "finish", _label: "Finish", displayName: "The end" }
      ],
      state: { score: 0, nested: { flag: true, note: null } }
    }
  },
  null,
  2
)}\n`;

function buildSnapshot(text: string): DocumentSnapshot {
  return createDocumentStore({ filePath: "games/sample/authoring/game.authoring.json", text }).snapshot();
}

/**
 * Two snapshots are observationally equal iff their serialized payloads match:
 * the payload captures text, json, diagnostics, selectedPointer, and every
 * location entry (which is exactly what `get`/`getEntry`/`entries` read back).
 */
function expectSnapshotsEqual(actual: DocumentSnapshot, expected: DocumentSnapshot): void {
  expect(serializeDocumentSnapshot(actual).payload).toEqual(serializeDocumentSnapshot(expected).payload);
}

describe("document snapshot serialization", () => {
  it("round-trips a parsed snapshot with a deep-equal payload and working location map", () => {
    const original = buildSnapshot(authoringText);
    const revived = reviveDocumentSnapshot(JSON.parse(JSON.stringify(serializeDocumentSnapshot(original))));

    expect(revived).not.toBeNull();
    expectSnapshotsEqual(revived as DocumentSnapshot, original);

    // The revived location map answers lookups identically without re-parsing.
    for (const entry of original.locationMap.entries()) {
      expect((revived as DocumentSnapshot).locationMap.get(entry.pointer)).toEqual(entry.value);
      expect((revived as DocumentSnapshot).locationMap.getEntry(entry.pointer)).toEqual(entry);
    }
    expect((revived as DocumentSnapshot).json).toEqual(original.json);
  });

  it("round-trips a snapshot whose JSON failed to parse (json undefined, syntax diagnostic kept)", () => {
    const original = buildSnapshot("{ not valid json ");
    expect(original.json).toBeUndefined();
    expect(original.diagnostics).toHaveLength(1);

    const revived = reviveDocumentSnapshot(JSON.parse(JSON.stringify(serializeDocumentSnapshot(original))));
    expect(revived).not.toBeNull();
    expect((revived as DocumentSnapshot).json).toBeUndefined();
    expectSnapshotsEqual(revived as DocumentSnapshot, original);
  });

  it("preserves the difference between a null document and a failed parse", () => {
    const nullDoc = reviveDocumentSnapshot(JSON.parse(JSON.stringify(serializeDocumentSnapshot(buildSnapshot("null\n")))));
    expect(nullDoc).not.toBeNull();
    expect((nullDoc as DocumentSnapshot).json).toBeNull();
  });

  it("revives garbage, wrong shapes, and foreign versions as null (a silent miss)", () => {
    expect(reviveDocumentSnapshot(null)).toBeNull();
    expect(reviveDocumentSnapshot(42)).toBeNull();
    expect(reviveDocumentSnapshot("not an envelope")).toBeNull();
    expect(reviveDocumentSnapshot([])).toBeNull();
    expect(reviveDocumentSnapshot({})).toBeNull();
    expect(reviveDocumentSnapshot({ formatVersion: DOCUMENT_SNAPSHOT_CACHE_FORMAT_VERSION })).toBeNull();
    expect(
      reviveDocumentSnapshot({ formatVersion: DOCUMENT_SNAPSHOT_CACHE_FORMAT_VERSION, payload: { filePath: 1 } })
    ).toBeNull();

    // Right shape but a foreign (bumped) format version must not be read.
    const envelope = serializeDocumentSnapshot(buildSnapshot(authoringText));
    const foreign = { ...envelope, formatVersion: DOCUMENT_SNAPSHOT_CACHE_FORMAT_VERSION + 1 };
    expect(reviveDocumentSnapshot(foreign)).toBeNull();
  });
});
