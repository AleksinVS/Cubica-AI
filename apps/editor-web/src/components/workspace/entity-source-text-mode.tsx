"use client";

/**
 * Entity-panel TEXT MODE ("источник") — the editable prompt-projection surface
 * behind the inspector's «⌗» icon (Phase 4.2; editor-preview-first-ux §4, §6;
 * design-spec §3.2; mockup card «Текстовый режим панели ("источник")»).
 *
 * WHAT IT IS. The author edits not YAML-as-a-format but a "text that looks like
 * YAML" — the hand-rolled prompt projection of ONE game entity (title, variants,
 * style, …) rendered with Russian labels (ADR-049). The returned text is a
 * COMMAND to interpret, never data applied mechanically. Pressing «Применить как
 * намерение» runs the returned text through the interpreter pipeline (Phase 4.1
 * core `interpretReturnedIntent`): a deterministic fast path (only known-key value
 * edits / a clean collection-item delete → a ChangeSet applied through the shared
 * single point) or, otherwise, the agent path (forwarded to the existing agent
 * contour). After applying, every changed fragment is shown in one of three
 * buckets — applied / recognized-no-change / unrecognized — so nothing is dropped
 * silently (ADR-057 §5).
 *
 * EDITOR CHOICE. The projection is a few dozen lines, the panel floats over the
 * preview, and the mockup itself shows a plain monospace block. Mounting a second
 * Monaco instance in the floating panel (the JSON sidebar already owns the single
 * `editorRef`) is disproportionate, so a monospace `<textarea>` is used — matching
 * the mockup exactly and avoiding a second Monaco lifecycle (design-spec §3.2
 * allows the textarea substitute when Monaco is heavy to embed here).
 *
 * DATA-ONLY. It never reads authoring data itself: the immutable capture
 * (projection text + facet source map + captured source hashes + entity id) is
 * supplied by the controller when the mode opens, and apply/refresh are callbacks.
 * No game/channel/type ids are hardcoded (CLAUDE §10).
 */
import type { InterpretationLineReport, ReturnedIntentInput } from "@cubica/editor-engine";
import React, { useState } from "react";

/**
 * The immutable context captured WHEN the text mode opens (design-spec §2.2,
 * "Захват контекста при открытии режима"): the projection text the author starts
 * from, its hidden facet source map, the source hashes of the entity's authoring
 * documents at capture time, and the entity id. It is the `ReturnedIntentInput`
 * minus the (still-being-edited) `returnedText`.
 */
export type EntitySourceCapture = Omit<ReturnedIntentInput, "returnedText">;

/**
 * Outcome the controller returns from applying a returned intent, so the panel can
 * render the stale plaque, the three-bucket report, and a plain-words notice.
 */
export interface ReturnedIntentApplyOutcome {
  readonly path: "deterministic" | "agent";
  /** `true` → the projection is stale (source hashes diverged); nothing applied. */
  readonly stale: boolean;
  /** Per-fragment interpretation report (empty on the stale path). */
  readonly report: readonly InterpretationLineReport[];
  /** `true` → a deterministic ChangeSet was applied through the shared pipeline. */
  readonly applied: boolean;
  /** `true` → the agent path forwarded the context to the existing agent contour. */
  readonly forwarded: boolean;
  /** Human-facing summary of what happened (Russian), shown under the report. */
  readonly message?: string;
}

export interface EntitySourceTextModeProps {
  /** The context captured on open; also reseeds the editor when it changes. */
  readonly capture: EntitySourceCapture;
  /** Re-captures the projection + fresh source hashes (used by the stale refresh). */
  readonly onRecapture: () => void;
  /** Runs the returned text through the interpreter → shared pipeline. */
  readonly onApply: (input: ReturnedIntentInput) => ReturnedIntentApplyOutcome;
  /** Leaves the text mode and returns to the form. */
  readonly onExit: () => void;
}

/** Plain-words Russian bucket labels (domain-facing, per the mockup). */
const bucketLabel: Readonly<Record<InterpretationLineReport["bucket"], string>> = {
  applied: "применено",
  "recognized-no-change": "распознано, без изменений",
  unrecognized: "не распознано"
};
const bucketClass: Readonly<Record<InterpretationLineReport["bucket"], string>> = {
  applied: "is-applied",
  "recognized-no-change": "is-noop",
  unrecognized: "is-unrecognized"
};

export function EntitySourceTextMode({ capture, onRecapture, onApply, onExit }: EntitySourceTextModeProps) {
  const [draft, setDraft] = useState<string>(capture.projectionYaml);
  const [report, setReport] = useState<readonly InterpretationLineReport[] | null>(null);
  const [stale, setStale] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  // Reseed the editable draft (and clear the last result) whenever the capture
  // changes: switching entities reuses this window, and the stale «Обновить»
  // refresh re-captures a fresh projection. Same derived-state seed pattern the
  // inspector uses for its channel state, so no remount/effect is needed.
  const [seededYaml, setSeededYaml] = useState<string>(capture.projectionYaml);
  if (seededYaml !== capture.projectionYaml) {
    setSeededYaml(capture.projectionYaml);
    setDraft(capture.projectionYaml);
    setReport(null);
    setStale(false);
    setNotice(undefined);
  }

  const handleApply = () => {
    const outcome = onApply({
      projectionYaml: capture.projectionYaml,
      returnedText: draft,
      facetSourceMap: capture.facetSourceMap,
      sourceHashes: capture.sourceHashes,
      entityId: capture.entityId
    });
    setStale(outcome.stale);
    setReport(outcome.stale ? null : outcome.report);
    setNotice(outcome.message);
  };

  const applied = report?.filter((line) => line.bucket === "applied") ?? [];
  const noChange = report?.filter((line) => line.bucket === "recognized-no-change") ?? [];
  const unrecognized = report?.filter((line) => line.bucket === "unrecognized") ?? [];

  return (
    <div className="entity-source-text-mode">
      <div className="entity-source-toolbar">
        <span className="entity-source-hash-badge" title="Хеши документов-источников захвачены при открытии режима">
          хеш источников: захвачен
        </span>
        <button type="button" className="entity-source-exit" onClick={onExit}>
          ← К форме
        </button>
      </div>

      <textarea
        className="entity-source-textarea"
        aria-label="Source projection text"
        spellCheck={false}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />

      <div className="entity-source-actions">
        <button type="button" className="entity-source-apply" onClick={handleApply}>
          Применить как намерение
        </button>
      </div>

      {stale ? (
        <div className="entity-source-stale" role="alert">
          <span>Источник изменился — обновите проекцию перед применением.</span>
          <button
            type="button"
            className="entity-source-refresh"
            onClick={() => {
              setStale(false);
              setNotice(undefined);
              onRecapture();
            }}
          >
            Обновить проекцию
          </button>
        </div>
      ) : null}

      {report !== null ? (
        <div className="entity-source-report" aria-label="Interpretation report">
          <ReportBucket title={`${bucketLabel.applied} (${applied.length})`} bucket="applied" lines={applied} showPointer />
          <ReportBucket title={`${bucketLabel["recognized-no-change"]} (${noChange.length})`} bucket="recognized-no-change" lines={noChange} />
          <ReportBucket title={`${bucketLabel.unrecognized} (${unrecognized.length})`} bucket="unrecognized" lines={unrecognized} />
        </div>
      ) : null}

      {notice !== undefined ? <p className="entity-source-notice">{notice}</p> : null}
    </div>
  );
}

function ReportBucket({
  title,
  bucket,
  lines,
  showPointer = false
}: {
  readonly title: string;
  readonly bucket: InterpretationLineReport["bucket"];
  readonly lines: readonly InterpretationLineReport[];
  readonly showPointer?: boolean;
}) {
  if (lines.length === 0) {
    return null;
  }
  return (
    <div className={`entity-source-bucket ${bucketClass[bucket]}`}>
      <div className="entity-source-bucket-title">{title}</div>
      <ul>
        {lines.map((line, index) => (
          <li key={`${line.fragment}:${index}`}>
            <code>{line.fragment}</code>
            {showPointer && line.targetPointer !== undefined ? <span className="entity-source-pointer">{line.targetPointer}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
