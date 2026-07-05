/**
 * Left-sidebar timeline panel.
 *
 * Lists the recent runtime preview trace events and, when one is selected,
 * renders the {@link PreviewTraceDetailPanel} with restore/reset/replay
 * actions. Purely presentational: trace data, selection, and rollback state are
 * owned by `EditorWorkspace` and passed through props.
 */
import type {
  PreviewPlaythroughEvent,
  PreviewPlaythroughSnapshot
} from "@cubica/editor-engine";

import { PreviewTraceDetailPanel } from "./preview-trace-detail-panel.tsx";

export function TimelineSidebarPanel({
  traceEntries,
  selectedTraceEvent,
  selectedTraceSnapshot,
  selectedTraceSequence,
  currentTraceSequence,
  rollbackState,
  onCollapse,
  onSelectTraceSequence,
  onRestoreSelectedTrace,
  onReset,
  onReplayCurrent
}: {
  readonly traceEntries: readonly PreviewPlaythroughEvent[];
  readonly selectedTraceEvent: PreviewPlaythroughEvent | undefined;
  readonly selectedTraceSnapshot: PreviewPlaythroughSnapshot | undefined;
  readonly selectedTraceSequence: number | undefined;
  readonly currentTraceSequence: number | undefined;
  readonly rollbackState: "idle" | "restoring" | "restored" | "blocked" | "error";
  readonly onCollapse: () => void;
  readonly onSelectTraceSequence: (sequence: number) => void;
  readonly onRestoreSelectedTrace: () => void;
  readonly onReset: () => void;
  readonly onReplayCurrent: () => void;
}) {
  return (
    <>
      <div className="panel-heading">
        <strong>Timeline</strong>
        <button type="button" onClick={onCollapse}>
          Collapse
        </button>
      </div>
      <div className="timeline-sidebar-body">
        <section className="timeline-sidebar-section" aria-label="Runtime trace">
          <div className="timeline-sidebar-section-heading">
            <strong>Runtime</strong>
            <span>{traceEntries.length}</span>
          </div>
          {traceEntries.length === 0 ? (
            <p className="empty-state">No runtime events</p>
          ) : (
            traceEntries.map((event) => (
              <button
                key={event.id}
                type="button"
                aria-pressed={selectedTraceSequence === event.sequence}
                className={[
                  "timeline-event",
                  currentTraceSequence === event.sequence ? "is-current" : "",
                  selectedTraceSequence === event.sequence ? "is-selected" : ""
                ].filter(Boolean).join(" ")}
                disabled={rollbackState === "restoring"}
                title={`Inspect runtime preview event ${event.sequence}`}
                onClick={() => onSelectTraceSequence(event.sequence)}
              >
                <span>T{event.sequence}</span>
                <strong>{event.label}</strong>
                {currentTraceSequence === event.sequence ? <b>Current</b> : null}
              </button>
            ))
          )}
        </section>
        {selectedTraceEvent !== undefined ? (
          <PreviewTraceDetailPanel
            event={selectedTraceEvent}
            snapshot={selectedTraceSnapshot}
            currentSequence={currentTraceSequence}
            rollbackState={rollbackState}
            variant="sidebar"
            onRestore={onRestoreSelectedTrace}
            onReset={onReset}
            onReplayCurrent={onReplayCurrent}
          />
        ) : null}
      </div>
    </>
  );
}
