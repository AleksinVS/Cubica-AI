/**
 * Compact nonblocking footer notice for ADR-050 prototype audit freshness.
 *
 * The notice is intentionally separate from manifest diagnostics: a missed
 * weekly audit should be visible to authors, but it must not block save,
 * preview, or EditorChangeSet application.
 */
import React from "react";

export type PrototypeAuditNoticeKind = "missing" | "stale" | "failed" | "partial" | "outdated-report";

export interface PrototypeAuditNoticeRecord {
  readonly notification: PrototypeAuditNoticeKind;
  readonly message: string;
  readonly lastCompletedAt?: string;
  readonly llmStatus?: string;
  readonly reportUrl?: string;
  readonly reportPath?: string;
  readonly workflowUrl?: string;
  readonly summary?: {
    readonly deterministicCandidates?: number;
    readonly semanticCandidates?: number;
    readonly promotionCandidates?: number;
  };
}

export function PrototypeAuditNotice({
  notice,
  onSnooze
}: {
  readonly notice: PrototypeAuditNoticeRecord | null;
  readonly onSnooze: () => void;
}) {
  if (notice === null) {
    return null;
  }

  const actionUrl = notice.reportUrl ?? notice.workflowUrl;
  return (
    <details className={`prototype-audit-notice prototype-audit-notice-${notice.notification}`}>
      <summary>{summaryForNotice(notice)}</summary>
      <div className="prototype-audit-notice-popover">
        <p>{notice.message}</p>
        <dl>
          <div>
            <dt>Last completed</dt>
            <dd>{notice.lastCompletedAt ?? "unknown"}</dd>
          </div>
          <div>
            <dt>LLM status</dt>
            <dd>{notice.llmStatus ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Candidates</dt>
            <dd>{formatCandidateSummary(notice)}</dd>
          </div>
          {notice.reportUrl === undefined && notice.reportPath !== undefined ? (
            <div>
              <dt>Report</dt>
              <dd>{notice.reportPath}</dd>
            </div>
          ) : null}
        </dl>
        <div className="prototype-audit-notice-actions">
          {actionUrl !== undefined ? (
            <a href={actionUrl} target="_blank" rel="noreferrer">
              Open audit workflow
            </a>
          ) : null}
          <button type="button" onClick={onSnooze}>
            Snooze for session
          </button>
        </div>
      </div>
    </details>
  );
}

function summaryForNotice(notice: PrototypeAuditNoticeRecord): string {
  if (notice.notification === "missing") {
    return "Prototype audit: missing";
  }
  if (notice.notification === "stale") {
    return "Prototype audit: stale";
  }
  if (notice.notification === "failed") {
    return "Prototype audit: failed";
  }
  if (notice.notification === "partial") {
    return "Prototype audit: partial";
  }
  return "Prototype audit: outdated";
}

function formatCandidateSummary(notice: PrototypeAuditNoticeRecord): string {
  const summary = notice.summary;
  if (summary === undefined) {
    return "unknown";
  }
  return `${summary.deterministicCandidates ?? 0} deterministic, ${summary.semanticCandidates ?? 0} semantic, ${summary.promotionCandidates ?? 0} promotion`;
}
