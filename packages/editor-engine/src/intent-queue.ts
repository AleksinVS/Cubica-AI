/**
 * Intent queue with optimistic concurrency (ADR-057 §4.11; editor-preview-first-ux
 * §9.5; design-spec §2.4).
 *
 * WHAT THIS IS. An "intent" ("интент") is a queued agent job — a request the
 * author gave to an AI channel (panel chat, session chat, region/entity preview
 * prompt, text-mode "apply as intent"). Unlike a manual form edit (which is
 * deterministic and cheap, so it applies immediately and NEVER enters this
 * queue), an agent intent is scheduled: it moves through statuses and its result
 * is reconciled against the live document at apply time.
 *
 * OPTIMISTIC CONCURRENCY (no locks). When an intent is created it CAPTURES three
 * things: the current journal sequence number (`baseJournalSeq` — how many edits
 * had been committed), the pointers the agent READ as context (`readPointers`),
 * and the pointers it plans to WRITE (`writePointers`). Entities are never locked
 * while the agent works. The conflict is resolved only at apply time: if any
 * journal entry committed AFTER `baseJournalSeq` touched a pointer inside the
 * union `readPointers ∪ writePointers`, the intent is `stale` and the author
 * chooses what to do (apply anyway / show / cancel). Non-overlapping edits apply
 * cleanly. This generalises `prompt-stale` (ADR-049) to every agent operation.
 *
 * "A JOURNAL ENTRY TOUCHED A POINTER." A committed edit is described here by its
 * `changedPointers` — the concrete JSON Pointers it mutated. The editor derives
 * those from a `PatchJournalStep`'s diff summary via
 * {@link changedPointersFromDiffSummary} (each item already carries the file path
 * and pointer of the change). "Touched" then means: some changed pointer overlaps
 * some guarded pointer, tested with the shared {@link pointersOverlap} predicate
 * (symmetric same-or-descendant), so an edit that lands INSIDE a read/write
 * subtree AND an edit that REPLACES it from above both count.
 *
 * MVP CONCURRENCY LIMIT. At most one intent is active (`running` or `applying`)
 * per session; the rest wait as `pending` and are promoted one at a time
 * ({@link promoteNextRunnableIntent}). Parallel runs over disjoint entities are a
 * later optimisation.
 *
 * PURITY. Everything here is pure, deterministic, and framework-agnostic: the
 * reducer functions take an immutable {@link IntentQueueEntry} list and return a
 * new one; {@link createIntentQueue} is a thin stateful wrapper that hands out
 * the §2.4 live {@link QueuedIntent} object (with a bound `cancel()`). No React,
 * no network, no game-specific knowledge.
 */
import { pointersOverlap } from "./semantics.ts";
import type { EditorDiffSummaryItem } from "./types.ts";

/**
 * Diagnostic code surfaced (as info) when a journal edit touched an intent's
 * read/write pointers — the author must choose apply-anyway / show / cancel
 * (design-spec §4, "intent-stale").
 */
export const INTENT_STALE_DIAGNOSTIC_CODE = "intent-stale";

/**
 * Lifecycle status of a queued intent (§2.4; §9.5
 * ожидает→выполняется→применяется→готово/ошибка/отменён/устарел).
 */
export type QueuedIntentStatus =
  | "pending"
  | "running"
  | "applying"
  | "done"
  | "failed"
  | "cancelled"
  | "stale";

/**
 * The §2.4 intent contract as a LIVE object (with `cancel()`), handed to UI/host
 * code by {@link createIntentQueue}. Fields are `readonly` to match the engine
 * convention; the mutable `status` of §2.4 is modelled by re-reading the object
 * from the queue after a transition rather than mutating in place.
 */
export interface QueuedIntent {
  readonly id: string;
  readonly status: QueuedIntentStatus;
  readonly baseJournalSeq: number;
  readonly readPointers: readonly string[];
  readonly writePointers: readonly string[];
  /** Cancels this intent (pending/running/stale). No-op once applying/terminal. */
  cancel(): void;
}

/**
 * Immutable data mirror of a queued intent, the unit the pure reducer transforms
 * and a host (React) keeps in state. It is {@link QueuedIntent} minus the
 * `cancel()` method, which a host binds when it projects an entry to the UI.
 */
export interface IntentQueueEntry {
  readonly id: string;
  readonly status: QueuedIntentStatus;
  readonly baseJournalSeq: number;
  readonly readPointers: readonly string[];
  readonly writePointers: readonly string[];
}

/** A committed journal edit reduced to the pointers it changed. */
export interface IntentJournalEntry {
  /** Zero-based position of this edit in the journal (its sequence number). */
  readonly seq: number;
  /** File-scoped JSON Pointers this edit mutated (see the module header). */
  readonly changedPointers: readonly string[];
}

/** Input captured when an agent intent enters the queue (§2.4). */
export interface EnqueueIntentInput {
  readonly id: string;
  readonly baseJournalSeq: number;
  readonly readPointers: readonly string[];
  readonly writePointers: readonly string[];
}

/**
 * Legal status transitions. The happy path is
 * pending → running → applying → done. A running intent may branch to `stale`
 * (conflict found at apply), `failed` (dry-run/validation rejected it) or
 * `cancelled`. A `stale` intent resolves to `applying` (apply anyway) or
 * `cancelled`. Cancellation is allowed from pending/running/stale but NOT from
 * `applying` (the durable mutation is already underway) or terminal states.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<QueuedIntentStatus, readonly QueuedIntentStatus[]>> = {
  pending: ["running", "cancelled"],
  running: ["applying", "stale", "failed", "cancelled"],
  applying: ["done", "failed"],
  stale: ["applying", "cancelled"],
  done: [],
  failed: [],
  cancelled: []
};

/** True when `to` is a legal next status after `from`. */
export function canTransitionIntentStatus(from: QueuedIntentStatus, to: QueuedIntentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Appends a new `pending` intent; does not promote it (see {@link promoteNextRunnableIntent}). */
export function enqueueIntent(
  entries: readonly IntentQueueEntry[],
  input: EnqueueIntentInput
): readonly IntentQueueEntry[] {
  return [
    ...entries,
    {
      id: input.id,
      status: "pending",
      baseJournalSeq: input.baseJournalSeq,
      readPointers: [...input.readPointers],
      writePointers: [...input.writePointers]
    }
  ];
}

/**
 * Moves the intent `id` to `next`, throwing on an illegal transition so a wiring
 * bug surfaces deterministically instead of silently corrupting queue state. An
 * unknown `id` returns the list unchanged.
 */
export function transitionIntent(
  entries: readonly IntentQueueEntry[],
  id: string,
  next: QueuedIntentStatus
): readonly IntentQueueEntry[] {
  return entries.map((entry) => {
    if (entry.id !== id) {
      return entry;
    }
    if (!canTransitionIntentStatus(entry.status, next)) {
      throw new Error(`Illegal intent transition ${entry.status} → ${next} for intent ${id}.`);
    }
    return { ...entry, status: next };
  });
}

/**
 * Refines an intent's captured pointers (e.g. writePointers become known once the
 * agent returns a planned ChangeSet). Read/write default to the existing values.
 */
export function refineIntentPointers(
  entries: readonly IntentQueueEntry[],
  id: string,
  patch: { readonly readPointers?: readonly string[]; readonly writePointers?: readonly string[] }
): readonly IntentQueueEntry[] {
  return entries.map((entry) =>
    entry.id === id
      ? {
          ...entry,
          readPointers: patch.readPointers === undefined ? entry.readPointers : [...patch.readPointers],
          writePointers: patch.writePointers === undefined ? entry.writePointers : [...patch.writePointers]
        }
      : entry
  );
}

/** True when some intent is `running` or `applying` (the MVP one-active limit). */
export function hasActiveIntent(entries: readonly IntentQueueEntry[]): boolean {
  return entries.some((entry) => entry.status === "running" || entry.status === "applying");
}

/** Id of the oldest `pending` intent, or undefined when none waits. */
export function nextPendingIntentId(entries: readonly IntentQueueEntry[]): string | undefined {
  return entries.find((entry) => entry.status === "pending")?.id;
}

/**
 * Promotes the oldest `pending` intent to `running` — but only when nothing is
 * active, enforcing the MVP "one running per session" rule. A no-op otherwise.
 */
export function promoteNextRunnableIntent(entries: readonly IntentQueueEntry[]): readonly IntentQueueEntry[] {
  if (hasActiveIntent(entries)) {
    return entries;
  }
  const id = nextPendingIntentId(entries);
  return id === undefined ? entries : transitionIntent(entries, id, "running");
}

/** The guarded pointer set of an intent: readPointers ∪ writePointers, deduped. */
export function unionIntentPointers(entry: IntentQueueEntry): readonly string[] {
  return [...new Set([...entry.readPointers, ...entry.writePointers])];
}

/** Journal entries committed at or after `baseJournalSeq` (i.e. since capture). */
export function selectJournalEntriesSince(
  journal: readonly IntentJournalEntry[],
  baseJournalSeq: number
): readonly IntentJournalEntry[] {
  return journal.filter((entry) => entry.seq >= baseJournalSeq);
}

/**
 * Optimistic-concurrency conflict test (§2.4). Returns true when a journal edit
 * committed after the intent's `baseJournalSeq` touched a pointer inside
 * `readPointers ∪ writePointers`. `journalEntriesSince` may be the full journal —
 * entries older than the capture point are ignored by their `seq`, so the call is
 * robust regardless of pre-filtering.
 */
export function detectIntentConflict(
  entry: IntentQueueEntry,
  journalEntriesSince: readonly IntentJournalEntry[]
): boolean {
  const guarded = unionIntentPointers(entry);
  if (guarded.length === 0) {
    return false;
  }
  return journalEntriesSince.some(
    (journalEntry) =>
      journalEntry.seq >= entry.baseJournalSeq &&
      journalEntry.changedPointers.some((changed) => guarded.some((pointer) => pointersOverlap(changed, pointer)))
  );
}

/**
 * Derives the file-scoped changed pointers of a committed edit from its diff
 * summary (each item carries the file path and pointer it mutated). Pointers are
 * scoped as `${filePath}${pointer}` so cross-file intents never falsely conflict;
 * intent read/write pointers must use the SAME scoping to compare correctly.
 */
export function changedPointersFromDiffSummary(items: readonly EditorDiffSummaryItem[]): readonly string[] {
  return [...new Set(items.map((item) => `${item.filePath}${item.pointer}`))];
}

/** The stateful §2.4 queue surface returned by {@link createIntentQueue}. */
export interface IntentQueue {
  /** Enqueues a new pending intent and returns its live object. */
  enqueue(input: EnqueueIntentInput): QueuedIntent;
  /** Every intent as a live object, in enqueue order. */
  list(): readonly QueuedIntent[];
  /** One intent by id, or undefined. */
  get(id: string): QueuedIntent | undefined;
  /** Moves an intent to a new status (throws on an illegal transition). */
  transition(id: string, next: QueuedIntentStatus): void;
  /** Promotes the next pending intent to running under the one-active rule. */
  promoteNext(): void;
  /** True when the intent conflicts with journal edits since it was captured. */
  detectConflict(id: string, journalEntriesSince: readonly IntentJournalEntry[]): boolean;
}

/**
 * Creates a stateful intent queue that exposes the §2.4 {@link QueuedIntent}
 * contract (live objects with `cancel()`), implemented entirely on top of the
 * pure reducer functions above. Provided for hosts that want the object contract
 * directly; a React host may instead keep {@link IntentQueueEntry}[] in state and
 * drive the same pure functions itself.
 */
export function createIntentQueue(): IntentQueue {
  let entries: readonly IntentQueueEntry[] = [];

  const toLiveObject = (entry: IntentQueueEntry): QueuedIntent => ({
    id: entry.id,
    status: entry.status,
    baseJournalSeq: entry.baseJournalSeq,
    readPointers: entry.readPointers,
    writePointers: entry.writePointers,
    cancel() {
      const current = entries.find((candidate) => candidate.id === entry.id);
      // Idempotent/safe: cancelling an applying or terminal intent is a no-op.
      if (current !== undefined && canTransitionIntentStatus(current.status, "cancelled")) {
        entries = transitionIntent(entries, entry.id, "cancelled");
      }
    }
  });

  return {
    enqueue(input) {
      entries = enqueueIntent(entries, input);
      return toLiveObject(entries[entries.length - 1] as IntentQueueEntry);
    },
    list() {
      return entries.map(toLiveObject);
    },
    get(id) {
      const entry = entries.find((candidate) => candidate.id === id);
      return entry === undefined ? undefined : toLiveObject(entry);
    },
    transition(id, next) {
      entries = transitionIntent(entries, id, next);
    },
    promoteNext() {
      entries = promoteNextRunnableIntent(entries);
    },
    detectConflict(id, journalEntriesSince) {
      const entry = entries.find((candidate) => candidate.id === id);
      return entry === undefined ? false : detectIntentConflict(entry, journalEntriesSince);
    }
  };
}
