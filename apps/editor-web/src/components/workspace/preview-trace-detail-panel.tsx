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

import { editorRu as t } from "@/lib/locale";

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
    <aside className={`preview-trace-detail preview-trace-detail-${variant}`} aria-label={t.traceDetail.detailsAria}>
      <div className="preview-trace-detail-head">
        <strong>{t.traceDetail.title}</strong>
        <span>{t.traceDetail.current} {currentSequence === undefined ? t.common.none : `T${currentSequence}`}</span>
      </div>
      <dl>
        <div>
          <dt>{t.traceDetail.selected}</dt>
          <dd>T{event.sequence}: {event.label}</dd>
        </div>
        <div>
          <dt>{t.traceDetail.kind}</dt>
          <dd>{event.kind}</dd>
        </div>
        <div>
          <dt>{t.traceDetail.snapshot}</dt>
          <dd>{hasSnapshot ? t.traceDetail.available : t.traceDetail.missing}</dd>
        </div>
      </dl>
      <div className="preview-trace-actions">
        <button type="button" disabled={!hasSnapshot || isRestoring} onClick={onRestore}>
          {t.traceDetail.restoreSelected}
        </button>
        <button type="button" disabled={currentSequence === undefined || isRestoring} onClick={onReset}>
          {t.traceDetail.resetToStart}
        </button>
        <button type="button" disabled={currentSequence === undefined || isRestoring} onClick={onReplayCurrent}>
          {t.traceDetail.replayCurrent}
        </button>
      </div>
      {event.payload !== undefined ? (
        <pre aria-label={t.traceDetail.payloadAria}>{formatTraceJsonPreview(event.payload)}</pre>
      ) : null}
    </aside>
  );
}
