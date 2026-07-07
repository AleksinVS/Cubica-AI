/**
 * Pure glue between the editor-engine intent queue and the editor-web controller
 * (ADR-057 §4.11; editor-preview-first-ux §9.5; design-spec §2.4).
 *
 * The queue STRUCTURE and its conflict rule live in `@cubica/editor-engine`
 * (framework-agnostic). This module holds only the small, deterministic
 * adapters the React controller needs, kept out of the controller so they can be
 * unit-tested without a full editor render:
 *
 *  - {@link deriveIntentJournalEntries} — turns the session AI-patch journal
 *    (the undo-capable {@link PatchJournalStep} list, i.e. "журнал правок сессии")
 *    into the engine's {@link IntentJournalEntry} shape. The journal index is the
 *    sequence number, and each step's changed pointers come from its diff summary.
 *  - {@link scopeActiveFilePointers} / {@link scopeChangeSetWritePointers} —
 *    file-scope plain JSON Pointers so conflict detection never mixes files (an
 *    intent's read/write pointers and the journal's changed pointers must share
 *    the SAME `${filePath}${pointer}` scoping to compare correctly).
 */
import {
  changedPointersFromDiffSummary,
  type EditorChangeSet,
  type IntentJournalEntry,
  type PatchJournalStep
} from "@cubica/editor-engine";

/**
 * Projects the session AI-patch journal to the engine's journal-entry shape used
 * by `detectIntentConflict`. The array index is the sequence number, so an intent
 * that captured `baseJournalSeq = journal.length` at submit will see exactly the
 * steps committed AFTER it (indices `>= baseJournalSeq`).
 */
export function deriveIntentJournalEntries(journal: readonly PatchJournalStep[]): readonly IntentJournalEntry[] {
  return journal.map((step, index) => ({
    seq: index,
    changedPointers: changedPointersFromDiffSummary(step.diffSummary)
  }));
}

/** File-scopes plain active-document JSON Pointers as `${filePath}${pointer}`. */
export function scopeActiveFilePointers(filePath: string, pointers: readonly string[]): readonly string[] {
  return [...new Set(pointers.filter((pointer) => pointer !== undefined).map((pointer) => `${filePath}${pointer}`))];
}

/**
 * The file-scoped write pointers of a planned ChangeSet — the concrete pointers
 * its JSON Patch operations mutate, across every touched file. Used to REFINE an
 * intent's write set once the agent (or the deterministic fast path) has returned
 * a ChangeSet, so conflict detection guards exactly what will be written.
 */
export function scopeChangeSetWritePointers(changeSet: EditorChangeSet): readonly string[] {
  return [
    ...new Set(
      changeSet.jsonPatches.flatMap((patch) =>
        patch.operations.map((operation) => `${patch.filePath}${operation.path}`)
      )
    )
  ];
}
