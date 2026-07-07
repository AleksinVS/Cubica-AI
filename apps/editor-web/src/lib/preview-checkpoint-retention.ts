/**
 * Retention of editor preview auto-checkpoints (ADR-057 §9.3).
 *
 * Auto-checkpoints are the runtime state snapshots persisted inside the tooling
 * trace files under `.tmp/editor-playthroughs/` (one file per runtime preview
 * session; see `preview-trace-store.ts`). Left unbounded they grow with every
 * playthrough, so the "последние N на сессию" policy caps how many snapshots are
 * kept per EDITOR session. This runs on the same garbage-collection cycle as the
 * rest of the editor `.tmp` cleanup (`garbageCollectEditorSessions`, ADR-042).
 *
 * Dropping these snapshots is always safe: they are tooling-only .tmp data and
 * can be re-produced by replaying a trace; nothing durable depends on them.
 */
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/** One trace file grouped for retention: its path, mtime, session, and doc. */
interface TraceFileState {
  readonly filePath: string;
  readonly mtimeMs: number;
  readonly editorSessionId: string;
  readonly doc: Record<string, unknown>;
  readonly snapshotSequences: readonly number[];
}

/**
 * Caps the number of auto-checkpoints kept per editor session to the newest
 * `keepPerSession`, rewriting the trace files that hold surplus snapshots.
 *
 * "Newest" orders a session's checkpoints by trace-file recency (mtime) first,
 * then by snapshot sequence within a file, so the most recent playthrough state
 * survives. A dropped checkpoint removes both the snapshot and its paired
 * timeline event, keeping the trace file internally consistent; events that
 * never had a snapshot are preserved.
 *
 * Only sessions present in `activeSessionIds` are considered — trace files of
 * removed / stale sessions are cleaned up wholesale elsewhere. Returns the
 * `<traceFilePath>#<eventSequence>` identifiers that were (or, in `dryRun` mode,
 * would be) dropped.
 */
export async function retainPreviewCheckpoints(input: {
  readonly root: string;
  readonly activeSessionIds: ReadonlySet<string>;
  readonly keepPerSession: number;
  readonly dryRun: boolean;
}): Promise<readonly string[]> {
  const files = await listTraceFiles(input.root);
  const bySession = new Map<string, TraceFileState[]>();
  for (const filePath of files) {
    const text = await readFile(filePath, "utf8").catch(() => undefined);
    const fileStat = await stat(filePath).catch(() => undefined);
    if (text === undefined || fileStat === undefined) {
      continue;
    }
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(text) as Record<string, unknown>;
    } catch {
      continue;
    }
    const editorSessionId = typeof doc.editorSessionId === "string" ? doc.editorSessionId : undefined;
    const snapshots = Array.isArray(doc.snapshots) ? doc.snapshots : [];
    if (editorSessionId === undefined || !input.activeSessionIds.has(editorSessionId) || snapshots.length === 0) {
      continue;
    }
    const snapshotSequences = snapshots
      .map((snapshot) => (snapshot as { readonly eventSequence?: unknown }).eventSequence)
      .filter((sequence): sequence is number => typeof sequence === "number");
    const group = bySession.get(editorSessionId) ?? [];
    group.push({ filePath, mtimeMs: fileStat.mtimeMs, editorSessionId, doc, snapshotSequences });
    bySession.set(editorSessionId, group);
  }

  const dropped: string[] = [];
  for (const group of bySession.values()) {
    // Newest first: recent files, and within a file the highest sequences.
    const ordered = [...group].sort((left, right) => right.mtimeMs - left.mtimeMs);
    const checkpoints = ordered.flatMap((file) =>
      [...file.snapshotSequences].sort((left, right) => right - left).map((sequence) => ({ file, sequence }))
    );
    const surplus = checkpoints.slice(input.keepPerSession);
    if (surplus.length === 0) {
      continue;
    }

    const dropByFile = new Map<string, Set<number>>();
    for (const { file, sequence } of surplus) {
      const set = dropByFile.get(file.filePath) ?? new Set<number>();
      set.add(sequence);
      dropByFile.set(file.filePath, set);
      dropped.push(`${file.filePath}#${sequence}`);
    }

    if (input.dryRun) {
      continue;
    }
    for (const file of ordered) {
      const dropSet = dropByFile.get(file.filePath);
      if (dropSet === undefined) {
        continue;
      }
      const snapshots = (file.doc.snapshots as readonly unknown[]).filter(
        (snapshot) => !dropSet.has((snapshot as { readonly eventSequence?: number }).eventSequence ?? -1)
      );
      const events = Array.isArray(file.doc.events)
        ? file.doc.events.filter((event) => !dropSet.has((event as { readonly sequence?: number }).sequence ?? -1))
        : file.doc.events;
      const nextDoc = { ...file.doc, snapshots, events, updatedAt: new Date().toISOString() };
      await writeFile(file.filePath, `${JSON.stringify(nextDoc, null, 2)}\n`, "utf8");
    }
  }

  return dropped.sort();
}

/** Lists the flat `*.json` trace files under the playthroughs root (missing dir → none). */
async function listTraceFiles(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === "ENOENT") {
      return [];
    }
    throw error;
  });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(root, entry.name));
}
