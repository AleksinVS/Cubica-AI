/**
 * Left-sidebar timeline panel.
 *
 * Lists the recent runtime preview trace events and, when one is selected,
 * renders the {@link PreviewTraceDetailPanel} with restore/reset/replay
 * actions. It also hosts the "Закрепить как фикстуру" control (mockup zone 6):
 * a small name/label dialog that pins the current preview state as a reviewable
 * fixture. Trace data, selection, and rollback state are owned by
 * `EditorWorkspace` and passed through props; only the transient pin-dialog input
 * is local to this presentational panel.
 */
import React, { useState } from "react";

import type {
  PreviewPlaythroughEvent,
  PreviewPlaythroughSnapshot
} from "@cubica/editor-engine";

import { editorRu as t } from "@/lib/locale";

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
  onReplayCurrent,
  canPinFixture,
  onPinFixture
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
  readonly canPinFixture: boolean;
  readonly onPinFixture: (input: { readonly label: string; readonly note?: string }) => void;
}) {
  // Transient pin-dialog state: whether the name form is open and its draft label.
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [pinLabel, setPinLabel] = useState("");

  function submitPin() {
    const label = pinLabel.trim();
    if (label === "") {
      return;
    }
    onPinFixture({ label });
    setPinLabel("");
    setPinDialogOpen(false);
  }

  return (
    <>
      <div className="panel-heading">
        <strong>{t.timeline.title}</strong>
        <button type="button" onClick={onCollapse}>
          {t.common.collapse}
        </button>
      </div>
      <section className="timeline-pin-fixture" aria-label="Закрепить как фикстуру">
        {pinDialogOpen ? (
          <div className="timeline-pin-fixture-dialog">
            <input
              type="text"
              aria-label="Имя фикстуры"
              placeholder="Имя фикстуры, например «День 4»"
              value={pinLabel}
              onChange={(event) => setPinLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submitPin();
                } else if (event.key === "Escape") {
                  setPinDialogOpen(false);
                }
              }}
              autoFocus
            />
            <div className="timeline-pin-fixture-actions">
              <button type="button" onClick={submitPin} disabled={pinLabel.trim() === ""}>
                Закрепить
              </button>
              <button type="button" onClick={() => setPinDialogOpen(false)}>
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="timeline-pin-fixture-open"
            disabled={!canPinFixture}
            title={canPinFixture ? undefined : "Нужны сессия и состояние предпросмотра"}
            onClick={() => setPinDialogOpen(true)}
          >
            Закрепить как фикстуру
          </button>
        )}
      </section>
      <div className="timeline-sidebar-body">
        <section className="timeline-sidebar-section" aria-label={t.timeline.runtimeTraceAria}>
          <div className="timeline-sidebar-section-heading">
            <strong>{t.timeline.runtime}</strong>
            <span>{traceEntries.length}</span>
          </div>
          {traceEntries.length === 0 ? (
            <p className="empty-state">{t.timeline.noRuntimeEvents}</p>
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
                title={t.timeline.inspectEvent(event.sequence)}
                onClick={() => onSelectTraceSequence(event.sequence)}
              >
                <span>T{event.sequence}</span>
                <strong>{event.label}</strong>
                {currentTraceSequence === event.sequence ? <b>{t.timeline.current}</b> : null}
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
