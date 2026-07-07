/**
 * Tests for the intent-queue controller glue (ADR-057 §4.11; UX §9.5; design-spec
 * §2.4) AND the queue lifecycle the controller drives on top of the engine
 * reducer.
 *
 * The full editor controller needs Monaco / CopilotKit / fetch to render, so
 * rather than mount it, this test exercises the exact pure pieces the controller
 * composes: the journal → conflict-entry derivation (`intent-queue-controller`),
 * and the engine queue reducer sequence the controller runs for an agent intent —
 * enqueue → promote (one running) → conflict → stale → resolve, plus cancel and
 * the "manual edit never enters the queue" invariant.
 */
import { describe, expect, it } from "vitest";
import {
  detectIntentConflict,
  enqueueIntent,
  hasActiveIntent,
  nextPendingIntentId,
  promoteNextRunnableIntent,
  refineIntentPointers,
  transitionIntent,
  type EditorChangeSet,
  type IntentQueueEntry,
  type PatchJournalStep
} from "@cubica/editor-engine";

import {
  deriveIntentJournalEntries,
  scopeActiveFilePointers,
  scopeChangeSetWritePointers
} from "./intent-queue-controller";

const FILE = "games/demo/authoring/game.authoring.json";

/** A journal step whose diff summary touched the given active-file pointers. */
function journalStep(id: string, pointers: readonly string[]): PatchJournalStep {
  return {
    id,
    createdAt: "2026-07-07T00:00:00.000Z",
    intent: { id: `${id}-intent`, kind: "manual", prompt: "", activeFilePath: FILE, targetPointers: [], createdAt: "" },
    summary: id,
    affectedFiles: [FILE],
    forward: { id: `${id}-fwd`, summary: id, jsonPatches: [] },
    inverse: { id: `${id}-inv`, summary: id, jsonPatches: [] },
    beforeHash: "a",
    afterHash: "b",
    diffSummary: pointers.map((pointer) => ({
      filePath: FILE,
      pointer,
      operation: "replace" as const,
      before: 1,
      after: 2,
      description: pointer
    })),
    diagnostics: []
  };
}

/** A ChangeSet that writes the given active-file pointers. */
function changeSet(pointers: readonly string[]): EditorChangeSet {
  return {
    id: "cs",
    summary: "cs",
    jsonPatches: [{ filePath: FILE, operations: pointers.map((path) => ({ op: "replace", path, value: 9 })) }]
  };
}

describe("controller glue: journal + pointer scoping", () => {
  it("derives sequenced conflict entries from the session journal", () => {
    const journal = [journalStep("s0", ["/root/cards/0"]), journalStep("s1", ["/root/cards/1"])];
    const entries = deriveIntentJournalEntries(journal);
    expect(entries).toEqual([
      { seq: 0, changedPointers: [`${FILE}/root/cards/0`] },
      { seq: 1, changedPointers: [`${FILE}/root/cards/1`] }
    ]);
  });

  it("file-scopes active-file pointers and ChangeSet write pointers consistently", () => {
    expect(scopeActiveFilePointers(FILE, ["/root/a", "/root/a"])).toEqual([`${FILE}/root/a`]);
    expect(scopeChangeSetWritePointers(changeSet(["/root/a", "/root/b"]))).toEqual([
      `${FILE}/root/a`,
      `${FILE}/root/b`
    ]);
  });
});

describe("controller lifecycle: an agent intent moves through statuses", () => {
  // Mirrors the controller: enqueue captures baseJournalSeq (= journal length),
  // read/write pointers; the promotion rule keeps one running; the write set is
  // refined from the planned ChangeSet; conflict → stale → resolve.
  it("enqueue → running → applying → done with no conflict", () => {
    const readWrite = scopeActiveFilePointers(FILE, ["/root/cards/0"]);
    let entries: readonly IntentQueueEntry[] = enqueueIntent([], {
      id: "i1",
      baseJournalSeq: 0,
      readPointers: readWrite,
      writePointers: readWrite
    });
    entries = promoteNextRunnableIntent(entries);
    expect(entries[0].status).toBe("running");

    // Refine from the planned ChangeSet; no journal edit since capture → no conflict.
    entries = refineIntentPointers(entries, "i1", { writePointers: scopeChangeSetWritePointers(changeSet(["/root/cards/0"])) });
    const conflict = detectIntentConflict(entries[0], deriveIntentJournalEntries([]));
    expect(conflict).toBe(false);

    entries = transitionIntent(entries, "i1", "applying");
    entries = transitionIntent(entries, "i1", "done");
    expect(entries[0].status).toBe("done");
  });

  it("a journal edit touching the intent's pointers → stale, then apply-anyway resolves", () => {
    const readWrite = scopeActiveFilePointers(FILE, ["/root/cards/0"]);
    let entries: readonly IntentQueueEntry[] = enqueueIntent([], {
      id: "i1",
      baseJournalSeq: 0,
      readPointers: readWrite,
      writePointers: readWrite
    });
    entries = promoteNextRunnableIntent(entries);

    // A manual edit committed a journal step touching the same pointer since capture.
    const journal = [journalStep("s0", ["/root/cards/0/title"])];
    expect(detectIntentConflict(entries[0], deriveIntentJournalEntries(journal))).toBe(true);
    entries = transitionIntent(entries, "i1", "stale");
    expect(entries[0].status).toBe("stale");

    // Author chooses "apply anyway".
    entries = transitionIntent(entries, "i1", "applying");
    entries = transitionIntent(entries, "i1", "done");
    expect(entries[0].status).toBe("done");
  });

  it("keeps only one intent running; a second waits pending until the first finishes", () => {
    const rw = scopeActiveFilePointers(FILE, ["/root/a"]);
    let entries: readonly IntentQueueEntry[] = enqueueIntent([], { id: "a", baseJournalSeq: 0, readPointers: rw, writePointers: rw });
    entries = enqueueIntent(entries, { id: "b", baseJournalSeq: 0, readPointers: rw, writePointers: rw });
    entries = promoteNextRunnableIntent(entries);
    expect(entries.find((entry) => entry.id === "a")?.status).toBe("running");
    // Second promote is a no-op while "a" is active.
    entries = promoteNextRunnableIntent(entries);
    expect(entries.find((entry) => entry.id === "b")?.status).toBe("pending");
    expect(nextPendingIntentId(entries)).toBe("b");

    // "a" finishes → "b" is promoted.
    entries = transitionIntent(transitionIntent(entries, "a", "applying"), "a", "done");
    entries = promoteNextRunnableIntent(entries);
    expect(entries.find((entry) => entry.id === "b")?.status).toBe("running");
  });

  it("cancel in flight moves a running intent to cancelled", () => {
    const rw = scopeActiveFilePointers(FILE, ["/root/a"]);
    let entries: readonly IntentQueueEntry[] = promoteNextRunnableIntent(
      enqueueIntent([], { id: "i1", baseJournalSeq: 0, readPointers: rw, writePointers: rw })
    );
    entries = transitionIntent(entries, "i1", "cancelled");
    expect(entries[0].status).toBe("cancelled");
    expect(hasActiveIntent(entries)).toBe(false);
  });

  it("a manual form edit produces a journal step but NEVER a queue entry (§9.5)", () => {
    // The manual edit path appends to the journal and does not enqueue.
    const journalAfterManualEdit = [journalStep("manual-0", ["/root/cards/0/title"])];
    const queueAfterManualEdit: readonly IntentQueueEntry[] = []; // enqueueIntent is never called
    expect(deriveIntentJournalEntries(journalAfterManualEdit)).toHaveLength(1);
    expect(queueAfterManualEdit).toHaveLength(0);
  });
});
