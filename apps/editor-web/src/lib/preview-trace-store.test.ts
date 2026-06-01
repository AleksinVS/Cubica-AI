import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  previewTraceDocumentPath,
  updatePreviewTraceDocument
} from "./preview-trace-store";

const repoRoot = path.resolve(process.cwd(), ".tmp", "preview-trace-store-tests");

describe("preview trace store", () => {
  beforeEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
    await mkdir(repoRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("upserts snapshots and truncates future events after rollback", async () => {
    await updatePreviewTraceDocument({
      repoRoot,
      traceId: "preview-session-1",
      gameId: "simple-choice",
      editorSessionId: "editor-session-1",
      runtimeSessionId: "runtime-session-1",
      event: {
        id: "runtime:session:0",
        sequence: 0,
        timestamp: "2026-06-01T00:00:00.000Z",
        kind: "system",
        label: "Initial runtime state"
      },
      snapshot: {
        id: "preview-session-1:snapshot:0",
        eventSequence: 0,
        state: { public: { timeline: { screenId: "intro" } } }
      }
    });

    await updatePreviewTraceDocument({
      repoRoot,
      traceId: "preview-session-1",
      event: {
        id: "runtime:session:1",
        sequence: 1,
        timestamp: "2026-06-01T00:00:01.000Z",
        kind: "action",
        label: "choice.accept",
        payload: {
          sessionVersion: {
            stateVersion: 1,
            lastEventSequence: 1
          }
        }
      },
      snapshot: {
        id: "preview-session-1:snapshot:1",
        eventSequence: 1,
        state: { public: { timeline: { screenId: "result" } } }
      }
    });

    const truncated = await updatePreviewTraceDocument({
      repoRoot,
      traceId: "preview-session-1",
      truncateAfterSequence: 0
    });

    expect(truncated.events.map((event) => event.sequence)).toEqual([0]);
    expect(truncated.snapshots.map((snapshot) => snapshot.eventSequence)).toEqual([0]);

    const fileText = await readFile(previewTraceDocumentPath(repoRoot, "preview-session-1"), "utf8");
    expect(fileText).toContain("\"editorSessionId\": \"editor-session-1\"");
    expect(fileText).not.toContain("choice.accept");
  });

  it("rejects unsafe trace ids", async () => {
    await expect(
      updatePreviewTraceDocument({
        repoRoot,
        traceId: "../bad-trace"
      })
    ).rejects.toThrow(/safe file segment/u);
  });
});
