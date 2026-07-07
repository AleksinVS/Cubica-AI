/**
 * Tests for the agent intent queue with optimistic concurrency (ADR-057 §4.11;
 * editor-preview-first-ux §9.5; design-spec §2.4).
 *
 * The queue is pure and deterministic, so the fixtures are tiny and
 * game-neutral. Coverage: enqueue, the status-transition guard (positive +
 * negative), the read∪write conflict test (positive + negative, and the
 * baseJournalSeq boundary), the MVP "one running" promotion rule, cancel via the
 * live §2.4 object, and the diff-summary → changed-pointers derivation.
 */
import { describe, expect, it } from "vitest";
import {
  canTransitionIntentStatus,
  changedPointersFromDiffSummary,
  createIntentQueue,
  detectIntentConflict,
  enqueueIntent,
  hasActiveIntent,
  nextPendingIntentId,
  promoteNextRunnableIntent,
  refineIntentPointers,
  selectJournalEntriesSince,
  transitionIntent,
  unionIntentPointers,
  type EditorDiffSummaryItem,
  type IntentJournalEntry,
  type IntentQueueEntry
} from "../src/index.ts";

const GAME_FILE = "games/demo/authoring/game.authoring.json";

/** A pending intent that read `/root/cards/0` and plans to write `/root/cards/1`. */
function makeEntry(overrides: Partial<IntentQueueEntry> = {}): IntentQueueEntry {
  return {
    id: "intent-1",
    status: "pending",
    baseJournalSeq: 0,
    readPointers: [`${GAME_FILE}/root/cards/0`],
    writePointers: [`${GAME_FILE}/root/cards/1`],
    ...overrides
  };
}

/** A committed journal edit at `seq` that mutated `pointers` (file-scoped). */
function journalEntry(seq: number, pointers: readonly string[]): IntentJournalEntry {
  return { seq, changedPointers: [...pointers] };
}

describe("enqueue and pointer capture", () => {
  it("appends a pending intent that captures baseJournalSeq, read and write pointers", () => {
    const entries = enqueueIntent([], {
      id: "i1",
      baseJournalSeq: 3,
      readPointers: ["a"],
      writePointers: ["b"]
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: "i1", status: "pending", baseJournalSeq: 3 });
    expect(entries[0].readPointers).toEqual(["a"]);
    expect(entries[0].writePointers).toEqual(["b"]);
  });

  it("unions read and write pointers (deduplicated)", () => {
    const entry = makeEntry({ readPointers: ["x", "y"], writePointers: ["y", "z"] });
    expect([...unionIntentPointers(entry)].sort()).toEqual(["x", "y", "z"]);
  });

  it("refines write pointers once the planned ChangeSet is known", () => {
    const entries = enqueueIntent([], { id: "i1", baseJournalSeq: 0, readPointers: ["r"], writePointers: ["guess"] });
    const refined = refineIntentPointers(entries, "i1", { writePointers: ["actual"] });
    expect(refined[0].writePointers).toEqual(["actual"]);
    expect(refined[0].readPointers).toEqual(["r"]);
  });
});

describe("status transitions", () => {
  it("allows the happy path pending → running → applying → done", () => {
    expect(canTransitionIntentStatus("pending", "running")).toBe(true);
    expect(canTransitionIntentStatus("running", "applying")).toBe(true);
    expect(canTransitionIntentStatus("applying", "done")).toBe(true);
  });

  it("allows running → stale and stale → applying / cancelled", () => {
    expect(canTransitionIntentStatus("running", "stale")).toBe(true);
    expect(canTransitionIntentStatus("stale", "applying")).toBe(true);
    expect(canTransitionIntentStatus("stale", "cancelled")).toBe(true);
  });

  it("rejects illegal transitions (applying → cancelled, done → running)", () => {
    expect(canTransitionIntentStatus("applying", "cancelled")).toBe(false);
    expect(canTransitionIntentStatus("done", "running")).toBe(false);
    const entries = [makeEntry({ status: "applying" })];
    expect(() => transitionIntent(entries, "intent-1", "cancelled")).toThrow(/Illegal intent transition/);
  });

  it("moves a matching intent and leaves others untouched", () => {
    const entries = [makeEntry({ id: "a" }), makeEntry({ id: "b" })];
    const next = transitionIntent(entries, "a", "running");
    expect(next[0].status).toBe("running");
    expect(next[1].status).toBe("pending");
  });
});

describe("conflict detection (optimistic concurrency)", () => {
  it("flags a conflict when a later journal edit touched a read/write pointer", () => {
    const entry = makeEntry({ baseJournalSeq: 2 });
    const journal = [journalEntry(2, [`${GAME_FILE}/root/cards/0/title`])]; // inside the read subtree
    expect(detectIntentConflict(entry, journal)).toBe(true);
  });

  it("flags a conflict when an edit REPLACES a guarded subtree from above", () => {
    const entry = makeEntry({ baseJournalSeq: 0, readPointers: [`${GAME_FILE}/root/cards/0/title`], writePointers: [] });
    const journal = [journalEntry(0, [`${GAME_FILE}/root/cards/0`])]; // replaces the parent
    expect(detectIntentConflict(entry, journal)).toBe(true);
  });

  it("does NOT flag non-overlapping edits (disjoint pointers apply cleanly)", () => {
    const entry = makeEntry({ baseJournalSeq: 0 });
    const journal = [journalEntry(0, [`${GAME_FILE}/root/meta/title`])];
    expect(detectIntentConflict(entry, journal)).toBe(false);
  });

  it("ignores journal edits committed BEFORE the capture point (baseJournalSeq boundary)", () => {
    const entry = makeEntry({ baseJournalSeq: 5 });
    // A touching edit, but it happened at seq 4 — before the intent captured the journal.
    const journal = [journalEntry(4, [`${GAME_FILE}/root/cards/0`])];
    expect(detectIntentConflict(entry, journal)).toBe(false);
    // The same edit at seq 5 (at/after capture) DOES conflict.
    expect(detectIntentConflict(entry, [journalEntry(5, [`${GAME_FILE}/root/cards/0`])])).toBe(true);
  });

  it("does not conflict across files", () => {
    const entry = makeEntry({ baseJournalSeq: 0 });
    const journal = [journalEntry(0, ["games/other/authoring/ui.json/root/cards/0"])];
    expect(detectIntentConflict(entry, journal)).toBe(false);
  });

  it("selectJournalEntriesSince filters by the capture sequence", () => {
    const journal = [journalEntry(0, ["a"]), journalEntry(1, ["b"]), journalEntry(2, ["c"])];
    expect(selectJournalEntriesSince(journal, 1).map((entry) => entry.seq)).toEqual([1, 2]);
  });
});

describe("MVP one-running promotion", () => {
  it("promotes the oldest pending intent to running when nothing is active", () => {
    const entries = [makeEntry({ id: "a" }), makeEntry({ id: "b" })];
    const next = promoteNextRunnableIntent(entries);
    expect(next.find((entry) => entry.id === "a")?.status).toBe("running");
    expect(next.find((entry) => entry.id === "b")?.status).toBe("pending");
  });

  it("does NOT promote a second intent while one is running or applying", () => {
    expect(hasActiveIntent([makeEntry({ status: "running" })])).toBe(true);
    const entries = [makeEntry({ id: "a", status: "running" }), makeEntry({ id: "b" })];
    const next = promoteNextRunnableIntent(entries);
    expect(next.find((entry) => entry.id === "b")?.status).toBe("pending");
    expect(nextPendingIntentId(next)).toBe("b");
  });

  it("promotes the queued intent once the active one reaches a terminal state", () => {
    const running = [makeEntry({ id: "a", status: "running" }), makeEntry({ id: "b" })];
    const afterApply = transitionIntent(transitionIntent(running, "a", "applying"), "a", "done");
    const promoted = promoteNextRunnableIntent(afterApply);
    expect(promoted.find((entry) => entry.id === "b")?.status).toBe("running");
  });
});

describe("createIntentQueue live object (§2.4) + cancel in flight", () => {
  it("hands out §2.4 objects and cancels a running intent", () => {
    const queue = createIntentQueue();
    const intent = queue.enqueue({ id: "i1", baseJournalSeq: 0, readPointers: ["r"], writePointers: ["w"] });
    expect(intent.status).toBe("pending");
    queue.promoteNext();
    expect(queue.get("i1")?.status).toBe("running");
    queue.get("i1")?.cancel();
    expect(queue.get("i1")?.status).toBe("cancelled");
  });

  it("cancel() is a no-op once the intent is applying (durable mutation underway)", () => {
    const queue = createIntentQueue();
    queue.enqueue({ id: "i1", baseJournalSeq: 0, readPointers: [], writePointers: ["w"] });
    queue.promoteNext();
    queue.transition("i1", "applying");
    queue.get("i1")?.cancel();
    expect(queue.get("i1")?.status).toBe("applying");
  });

  it("detectConflict on the queue matches the pure function", () => {
    const queue = createIntentQueue();
    queue.enqueue({ id: "i1", baseJournalSeq: 0, readPointers: [`${GAME_FILE}/root/a`], writePointers: [] });
    expect(queue.detectConflict("i1", [journalEntry(0, [`${GAME_FILE}/root/a`])])).toBe(true);
    expect(queue.detectConflict("i1", [journalEntry(0, [`${GAME_FILE}/root/b`])])).toBe(false);
  });
});

describe("changedPointersFromDiffSummary", () => {
  it("file-scopes each diff item and deduplicates", () => {
    const items: readonly EditorDiffSummaryItem[] = [
      { filePath: GAME_FILE, pointer: "/root/cards/0", operation: "replace", before: 1, after: 2, description: "" },
      { filePath: GAME_FILE, pointer: "/root/cards/0", operation: "replace", before: 2, after: 3, description: "" },
      { filePath: GAME_FILE, pointer: "/root/cards/1", operation: "add", before: undefined, after: 9, description: "" }
    ];
    expect(changedPointersFromDiffSummary(items)).toEqual([
      `${GAME_FILE}/root/cards/0`,
      `${GAME_FILE}/root/cards/1`
    ]);
  });
});
