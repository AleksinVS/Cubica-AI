/**
 * Tests for the "last N auto-checkpoints per session" retention (ADR-057 §9.3).
 *
 * The retention operates on the tooling trace files under
 * `.tmp/editor-playthroughs/`. These tests write synthetic trace files with
 * controlled mtimes and assert that the newest N snapshots survive across a
 * session's files, that surplus snapshot/event pairs are dropped together, and
 * that dry-run reports without writing.
 */
import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { retainPreviewCheckpoints } from "./preview-checkpoint-retention";

const root = path.resolve(process.cwd(), ".tmp", "preview-checkpoint-retention-tests");

/** Writes a trace file with the given snapshots/events and stamps its mtime. */
async function writeTrace(
  name: string,
  editorSessionId: string,
  sequences: readonly number[],
  mtimeSeconds: number
): Promise<string> {
  const filePath = path.join(root, `${name}.json`);
  const doc = {
    version: 1,
    traceId: name,
    editorSessionId,
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
    events: sequences.map((sequence) => ({ id: `e${sequence}`, sequence, timestamp: "t", kind: "system", label: `T${sequence}` })),
    snapshots: sequences.map((sequence) => ({ id: `s${sequence}`, eventSequence: sequence, state: { at: sequence } }))
  };
  await writeFile(filePath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  await utimes(filePath, new Date(mtimeSeconds * 1000), new Date(mtimeSeconds * 1000));
  return filePath;
}

async function readSequences(filePath: string): Promise<{ readonly events: readonly number[]; readonly snapshots: readonly number[] }> {
  const doc = JSON.parse(await readFile(filePath, "utf8")) as {
    readonly events: readonly { readonly sequence: number }[];
    readonly snapshots: readonly { readonly eventSequence: number }[];
  };
  return {
    events: doc.events.map((event) => event.sequence),
    snapshots: doc.snapshots.map((snapshot) => snapshot.eventSequence)
  };
}

describe("retainPreviewCheckpoints (ADR-057 §9.3)", () => {
  beforeEach(async () => {
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("keeps the newest N snapshots across a session's trace files and drops surplus pairs", async () => {
    // Older file has seq 0..2; newer file has seq 3..4. With N=3 the newest three
    // (4, 3 from the newer file, then 2 from the older) survive; 0 and 1 are dropped.
    const older = await writeTrace("trace-a", "session-1", [0, 1, 2], 1_000);
    const newer = await writeTrace("trace-b", "session-1", [3, 4], 2_000);

    const dropped = await retainPreviewCheckpoints({
      root,
      activeSessionIds: new Set(["session-1"]),
      keepPerSession: 3,
      dryRun: false
    });

    expect(dropped).toEqual([`${older}#0`, `${older}#1`]);
    // The dropped snapshot AND its paired event are removed together.
    expect(await readSequences(older)).toEqual({ events: [2], snapshots: [2] });
    expect(await readSequences(newer)).toEqual({ events: [3, 4], snapshots: [3, 4] });
  });

  it("reports but does not write in dry-run mode", async () => {
    const file = await writeTrace("trace-a", "session-1", [0, 1, 2, 3], 1_000);
    const before = await stat(file);

    const dropped = await retainPreviewCheckpoints({
      root,
      activeSessionIds: new Set(["session-1"]),
      keepPerSession: 2,
      dryRun: true
    });

    expect(dropped).toEqual([`${file}#0`, `${file}#1`]);
    // Nothing changed on disk.
    expect(await readSequences(file)).toEqual({ events: [0, 1, 2, 3], snapshots: [0, 1, 2, 3] });
    expect((await stat(file)).mtimeMs).toBe(before.mtimeMs);
  });

  it("ignores trace files whose session is not active", async () => {
    const file = await writeTrace("trace-a", "other-session", [0, 1, 2, 3], 1_000);

    const dropped = await retainPreviewCheckpoints({
      root,
      activeSessionIds: new Set(["session-1"]),
      keepPerSession: 1,
      dryRun: false
    });

    expect(dropped).toEqual([]);
    expect(await readSequences(file)).toEqual({ events: [0, 1, 2, 3], snapshots: [0, 1, 2, 3] });
  });
});
