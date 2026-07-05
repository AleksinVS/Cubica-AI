/**
 * Detail panel for a single preview playthrough trace event.
 *
 * Shows the selected runtime event, whether a restorable snapshot exists, and
 * the restore/reset/replay actions. It is rendered inside the timeline sidebar
 * (variant "sidebar") and is otherwise a plain presentational component driven
 * entirely by props.
 */
import type {
  JsonValue,
  PreviewPlaythroughEvent,
  PreviewPlaythroughSnapshot
} from "@cubica/editor-engine";

/** Pretty-prints a trace event payload, truncating very large values. */
function formatTraceJsonPreview(value: JsonValue): string {
  const formatted = JSON.stringify(value, null, 2);
  if (formatted.length <= 720) {
    return formatted;
  }

  return `${formatted.slice(0, 720)}\n...`;
}

export function PreviewTraceDetailPanel({
  event,
  snapshot,
  currentSequence,
  rollbackState,
  variant = "floating",
  onRestore,
  onReset,
  onReplayCurrent
}: {
  event: PreviewPlaythroughEvent;
  snapshot: PreviewPlaythroughSnapshot | undefined;
  currentSequence: number | undefined;
  rollbackState: "idle" | "restoring" | "restored" | "blocked" | "error";
  variant?: "floating" | "sidebar";
  onRestore: () => void;
  onReset: () => void;
  onReplayCurrent: () => void;
}) {
  const hasSnapshot = snapshot !== undefined;
  const isRestoring = rollbackState === "restoring";

  return (
    <aside className={`preview-trace-detail preview-trace-detail-${variant}`} aria-label="Preview trace details">
      <div className="preview-trace-detail-head">
        <strong>Preview trace</strong>
        <span>Current {currentSequence === undefined ? "none" : `T${currentSequence}`}</span>
      </div>
      <dl>
        <div>
          <dt>Selected</dt>
          <dd>T{event.sequence}: {event.label}</dd>
        </div>
        <div>
          <dt>Kind</dt>
          <dd>{event.kind}</dd>
        </div>
        <div>
          <dt>Snapshot</dt>
          <dd>{hasSnapshot ? "available" : "missing"}</dd>
        </div>
      </dl>
      <div className="preview-trace-actions">
        <button type="button" disabled={!hasSnapshot || isRestoring} onClick={onRestore}>
          Restore selected
        </button>
        <button type="button" disabled={currentSequence === undefined || isRestoring} onClick={onReset}>
          Reset to start
        </button>
        <button type="button" disabled={currentSequence === undefined || isRestoring} onClick={onReplayCurrent}>
          Replay current
        </button>
      </div>
      {event.payload !== undefined ? (
        <pre aria-label="Selected trace event payload">{formatTraceJsonPreview(event.payload)}</pre>
      ) : null}
    </aside>
  );
}
