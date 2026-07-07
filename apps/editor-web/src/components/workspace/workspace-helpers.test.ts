/**
 * Unit tests for the preview apply-policy / freshness / recovery-ladder helpers
 * (ADR-057 §4.8; editor-preview-first-ux §9.2 / §9.6; design-spec §3.3, §4).
 *
 * These pure helpers are the single source of truth for the "две оси времени"
 * behaviour, so the acceptance checks (stale plate in Превью, auto-apply in
 * Дизайн, three freshness states, ladder rung messages) are asserted directly
 * on them rather than through brittle full-controller mounting.
 */
import { describe, expect, it } from "vitest";
import {
  createPreviewPlaythroughTrace,
  type JsonValue,
  type PreviewPlaythroughEvent,
  type PreviewPlaythroughSnapshot,
  type PreviewPlaythroughTrace
} from "@cubica/editor-engine";

import {
  derivePreviewFreshness,
  describePreviewFreshness,
  planPreviewRecoveryLadder,
  shouldAutoApplyPreview,
  shouldOfferPreviewApply
} from "./workspace-helpers.ts";

/** Builds a trace with events at the given sequences and snapshots at a subset. */
function traceWith(eventSequences: readonly number[], snapshotSequences: readonly number[]): PreviewPlaythroughTrace {
  const events: PreviewPlaythroughEvent[] = eventSequences.map((sequence) => ({
    id: `event-${sequence}`,
    sequence,
    timestamp: "2026-07-07T00:00:00.000Z",
    kind: sequence === 0 ? "system" : "action",
    label: sequence === 0 ? "Initial runtime state" : `Step ${sequence}`
  }));
  const snapshots: PreviewPlaythroughSnapshot[] = snapshotSequences.map((sequence) => ({
    id: `snapshot-${sequence}`,
    eventSequence: sequence,
    state: { step: sequence } as unknown as JsonValue
  }));
  return createPreviewPlaythroughTrace({ traceId: "trace-test", events, snapshots });
}

describe("derivePreviewFreshness (editor-preview-first-ux §9.6)", () => {
  it("reports the three prepared states plus unprepared", () => {
    expect(derivePreviewFreshness({ previewPrepared: false, compileBlocked: false, hasUnappliedEdits: true })).toBe(
      "unprepared"
    );
    expect(derivePreviewFreshness({ previewPrepared: true, compileBlocked: false, hasUnappliedEdits: false })).toBe(
      "fresh"
    );
    expect(derivePreviewFreshness({ previewPrepared: true, compileBlocked: false, hasUnappliedEdits: true })).toBe(
      "stale"
    );
    expect(derivePreviewFreshness({ previewPrepared: true, compileBlocked: true, hasUnappliedEdits: true })).toBe(
      "blocked"
    );
  });

  it("lets a broken compile win over unapplied edits", () => {
    expect(derivePreviewFreshness({ previewPrepared: true, compileBlocked: true, hasUnappliedEdits: false })).toBe(
      "blocked"
    );
  });
});

describe("describePreviewFreshness (design-spec §4 registry codes)", () => {
  it("maps stale/blocked to registry codes and warn/err tones", () => {
    expect(describePreviewFreshness("stale")).toEqual({
      code: "preview-stale",
      label: "предпросмотр отстаёт",
      tone: "warn"
    });
    expect(describePreviewFreshness("blocked")).toEqual({
      code: "preview-blocked",
      label: "предпросмотр заблокирован ошибками",
      tone: "err"
    });
    expect(describePreviewFreshness("fresh").code).toBeUndefined();
    expect(describePreviewFreshness("fresh").tone).toBe("ok");
  });
});

describe("apply policy predicates (design-spec §3.3)", () => {
  it("offers «Применить» only in Превью with unapplied valid edits and an idle pipeline", () => {
    expect(shouldOfferPreviewApply({ editorMode: "preview", freshness: "stale", workflowBusy: false })).toBe(true);
    expect(shouldOfferPreviewApply({ editorMode: "design", freshness: "stale", workflowBusy: false })).toBe(false);
    expect(shouldOfferPreviewApply({ editorMode: "preview", freshness: "fresh", workflowBusy: false })).toBe(false);
    expect(shouldOfferPreviewApply({ editorMode: "preview", freshness: "stale", workflowBusy: true })).toBe(false);
  });

  it("auto-applies only in Дизайн when the preview lags valid edits", () => {
    expect(shouldAutoApplyPreview({ editorMode: "design", freshness: "stale" })).toBe(true);
    expect(shouldAutoApplyPreview({ editorMode: "preview", freshness: "stale" })).toBe(false);
    expect(shouldAutoApplyPreview({ editorMode: "design", freshness: "fresh" })).toBe(false);
  });
});

describe("planPreviewRecoveryLadder (editor-preview-first-ux §9.2)", () => {
  it("restores straight to the current step when it has a snapshot", () => {
    const trace = traceWith([0, 1, 2], [0, 1, 2]);
    const rungs = planPreviewRecoveryLadder(trace, 2);
    expect(rungs[0]?.kind).toBe("current-step");
    expect(rungs[0]?.message).toContain("вернулись на текущий шаг");
    // The terminal restart rung is always present.
    expect(rungs[rungs.length - 1]?.kind).toBe("restart");
  });

  it("falls back to the nearest earlier snapshot and reports the replay count", () => {
    // Snapshot only at 0; events up to 3 -> nearest is 0, replay of 3 events.
    const trace = traceWith([0, 1, 2, 3], [0]);
    const rungs = planPreviewRecoveryLadder(trace, 3);
    const nearest = rungs.find((rung) => rung.kind === "nearest-snapshot");
    expect(nearest).toBeDefined();
    expect(nearest && "sequence" in nearest ? nearest.sequence : undefined).toBe(0);
    expect(nearest?.message).toContain("3 событий после него нужно повторить");
    // No exact current-step snapshot, so the first rung is not current-step.
    expect(rungs[0]?.kind).not.toBe("current-step");
  });

  it("offers step-start when only the run's first snapshot exists apart from the target", () => {
    // Snapshots at 0 and 2; target 5 -> nearest is 2, and 0 is offered as step-start.
    const trace = traceWith([0, 1, 2, 3, 4, 5], [0, 2]);
    const rungs = planPreviewRecoveryLadder(trace, 5);
    const kinds = rungs.map((rung) => rung.kind);
    expect(kinds).toContain("nearest-snapshot");
    expect(kinds).toContain("step-start");
    expect(kinds[kinds.length - 1]).toBe("restart");
    const stepStart = rungs.find((rung) => rung.kind === "step-start");
    expect(stepStart?.message).toContain("вернулись к началу шага");
  });

  it("degrades to a bare restart when there is nothing restorable", () => {
    const trace = traceWith([], []);
    const rungs = planPreviewRecoveryLadder(trace, undefined);
    expect(rungs).toHaveLength(1);
    expect(rungs[0]?.kind).toBe("restart");
    expect(rungs[0]?.message).toContain("перезапустили прохождение");
  });
});
