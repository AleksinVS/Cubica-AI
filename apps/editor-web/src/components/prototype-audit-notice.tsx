/**
 * Compact nonblocking footer notice for ADR-050 prototype audit freshness.
 *
 * The notice is intentionally separate from manifest diagnostics: a missed
 * weekly audit should be visible to authors, but it must not block save,
 * preview, or EditorChangeSet application.
 */
import React from "react";

import { editorRu as t } from "@/lib/locale";

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
            <dt>{t.prototypeAudit.lastCompleted}</dt>
            <dd>{notice.lastCompletedAt ?? t.common.unknown}</dd>
          </div>
          <div>
            <dt>{t.prototypeAudit.llmStatus}</dt>
            <dd>{notice.llmStatus ?? t.common.unknown}</dd>
          </div>
          <div>
            <dt>{t.prototypeAudit.candidates}</dt>
            <dd>{formatCandidateSummary(notice)}</dd>
          </div>
          {notice.reportUrl === undefined && notice.reportPath !== undefined ? (
            <div>
              <dt>{t.prototypeAudit.report}</dt>
              <dd>{notice.reportPath}</dd>
            </div>
          ) : null}
        </dl>
        <div className="prototype-audit-notice-actions">
          {actionUrl !== undefined ? (
            <a href={actionUrl} target="_blank" rel="noreferrer">
              {t.prototypeAudit.openWorkflow}
            </a>
          ) : null}
          <button type="button" onClick={onSnooze}>
            {t.prototypeAudit.snooze}
          </button>
        </div>
      </div>
    </details>
  );
}

function summaryForNotice(notice: PrototypeAuditNoticeRecord): string {
  if (notice.notification === "missing") {
    return t.prototypeAudit.summaryMissing;
  }
  if (notice.notification === "stale") {
    return t.prototypeAudit.summaryStale;
  }
  if (notice.notification === "failed") {
    return t.prototypeAudit.summaryFailed;
  }
  if (notice.notification === "partial") {
    return t.prototypeAudit.summaryPartial;
  }
  return t.prototypeAudit.summaryOutdated;
}

function formatCandidateSummary(notice: PrototypeAuditNoticeRecord): string {
  const summary = notice.summary;
  if (summary === undefined) {
    return t.common.unknown;
  }
  return t.prototypeAudit.candidateSummary(
    summary.deterministicCandidates ?? 0,
    summary.semanticCandidates ?? 0,
    summary.promotionCandidates ?? 0
  );
}
