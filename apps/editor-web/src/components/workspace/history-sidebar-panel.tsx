"use client";

/**
 * Durable author-version history for the editor's left sidebar.
 *
 * The panel uses browser-safe DTOs only: opaque version identifiers are passed
 * back to the controller, while repository mechanics stay behind the HTTP API.
 * It owns only short-lived presentation state for the restore confirmation.
 */
import React, { useEffect, useRef, useState } from "react";

import type {
  EditorVersionDetails,
  EditorVersionSummary
} from "@/lib/editor-version-contracts";
import { editorRu as t } from "@/lib/locale";

export type HistoryRequestState = "idle" | "loading" | "ready" | "error";
export type HistoryRestoreState = "idle" | "restoring" | "error";

export interface HistorySidebarPanelProps {
  readonly versions: readonly EditorVersionSummary[];
  readonly nextCursor?: string;
  readonly selectedVersionId?: string;
  readonly selectedDetails?: EditorVersionDetails;
  readonly listState: HistoryRequestState;
  readonly detailsState: HistoryRequestState;
  readonly restoreState: HistoryRestoreState;
  readonly error?: string;
  readonly isDirty: boolean;
  readonly onCollapse: () => void;
  readonly onRetry: () => void;
  readonly onLoadMore: () => void;
  readonly onSelectVersion: (versionId: string) => void;
  readonly onRestore: (versionId: string) => void;
}

export function HistorySidebarPanel({
  versions,
  nextCursor,
  selectedVersionId,
  selectedDetails,
  listState,
  detailsState,
  restoreState,
  error,
  isDirty,
  onCollapse,
  onRetry,
  onLoadMore,
  onSelectVersion,
  onRestore
}: HistorySidebarPanelProps) {
  const [confirmingVersion, setConfirmingVersion] = useState<EditorVersionSummary | undefined>();

  return (
    <>
      <div className="panel-heading history-heading">
        <strong>{t.history.title}</strong>
        <button type="button" onClick={onCollapse} aria-label={t.history.collapseAria}>{t.common.collapse}</button>
      </div>
      <div className="history-panel-body">
        {listState === "loading" && versions.length === 0 ? (
          <p className="history-panel-state" role="status" data-testid="history-loading">{t.history.loading}</p>
        ) : listState === "error" && versions.length === 0 ? (
          <HistoryError message={error} onRetry={onRetry} />
        ) : versions.length === 0 ? (
          <p className="history-panel-state" data-testid="history-empty">{t.history.empty}</p>
        ) : (
          <ol className="history-version-list" aria-label={t.history.listAria}>
            {versions.map((version) => (
              <li key={version.versionId}>
                <button
                  type="button"
                  className={version.versionId === selectedVersionId ? "is-selected" : ""}
                  aria-pressed={version.versionId === selectedVersionId}
                  onClick={() => onSelectVersion(version.versionId)}
                  data-testid="history-version-row"
                >
                  <span className="history-version-summary">{version.summary}</span>
                  <span className="history-version-meta">
                    {version.authorName || t.history.unknownAuthor}
                    <time dateTime={version.createdAt} title={formatExactVersionTime(version.createdAt)} aria-label={t.history.versionTimeAria(formatExactVersionTime(version.createdAt))}>
                      {formatRelativeVersionTime(version.createdAt)}
                    </time>
                  </span>
                  <span className="history-version-count">{t.history.fileCount(version.changedFileCount)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}

        {error !== undefined && versions.length > 0 ? <HistoryError message={error} onRetry={onRetry} compact /> : null}

        {nextCursor !== undefined ? (
          <button className="history-load-more" type="button" onClick={onLoadMore} disabled={listState === "loading"}>
            {listState === "loading" ? t.history.loadingMore : t.history.loadMore}
          </button>
        ) : null}

        {selectedVersionId !== undefined ? (
          <section className="history-version-details" aria-label={t.history.details} data-testid="history-version-details">
            <h3>{t.history.details}</h3>
            {detailsState === "loading" ? <p role="status">{t.history.loading}</p> : null}
            {detailsState === "error" ? <HistoryError message={error} onRetry={() => onSelectVersion(selectedVersionId)} compact /> : null}
            {selectedDetails !== undefined ? (
              <>
                <p className="history-version-comment">{selectedDetails.authorComment ?? t.history.noComment}</p>
                <h4>{t.history.changedFiles}</h4>
                <ul className="history-change-list">
                  {selectedDetails.changes.map((change, index) => (
                    <li key={`${change.filePath}:${change.previousFilePath ?? ""}:${index}`}>
                      <span className={`history-change-kind history-change-${change.kind}`}>{t.history.changeKind[change.kind]}</span>
                      <strong title={change.filePath}>{change.filePath}</strong>
                      <small>{change.summary}</small>
                    </li>
                  ))}
                </ul>
                {isDirty ? (
                  <div className="history-restore-blocked" role="note">
                    <strong>{t.history.restoreBlockedTitle}</strong>
                    <span>{t.history.restoreBlockedBody}</span>
                  </div>
                ) : null}
                <button
                  className="history-restore-action"
                  type="button"
                  disabled={isDirty || restoreState === "restoring"}
                  onClick={() => setConfirmingVersion(selectedDetails)}
                >
                  {restoreState === "restoring" ? t.history.restoring : t.history.restore}
                </button>
              </>
            ) : null}
          </section>
        ) : null}
      </div>

      {confirmingVersion !== undefined ? (
        <RestoreVersionDialog
          version={confirmingVersion}
          restoring={restoreState === "restoring"}
          onCancel={() => setConfirmingVersion(undefined)}
          onConfirm={() => {
            onRestore(confirmingVersion.versionId);
            setConfirmingVersion(undefined);
          }}
        />
      ) : null}
    </>
  );
}

function HistoryError({ message, onRetry, compact = false }: { readonly message?: string; readonly onRetry: () => void; readonly compact?: boolean }) {
  return (
    <div className={`history-panel-error ${compact ? "is-compact" : ""}`} role="alert" data-testid="history-error">
      <span>{message ?? t.history.errorDefault}</span>
      <button type="button" onClick={onRetry}>{t.history.retry}</button>
    </div>
  );
}

function RestoreVersionDialog({
  version,
  restoring,
  onCancel,
  onConfirm
}: {
  readonly version: EditorVersionSummary;
  readonly restoring: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !restoring) {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, restoring]);

  return (
    <div className="history-restore-backdrop" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !restoring) onCancel();
    }}>
      <section className="history-restore-dialog" role="dialog" aria-modal="true" aria-labelledby="history-restore-title">
        <h2 id="history-restore-title">{t.history.restoreConfirmTitle}</h2>
        <strong>{version.summary}</strong>
        <p>{t.history.restoreConfirmBody}</p>
        <div>
          <button type="button" onClick={onCancel} disabled={restoring}>{t.history.cancel}</button>
          <button ref={confirmRef} type="button" className="history-restore-confirm" onClick={onConfirm} disabled={restoring}>
            {restoring ? t.history.restoring : t.history.restoreConfirm}
          </button>
        </div>
      </section>
    </div>
  );
}

/** Stable relative time suitable for the newest-first history list. */
export function formatRelativeVersionTime(isoDate: string, now = Date.now()): string {
  const timestamp = Date.parse(isoDate);
  if (!Number.isFinite(timestamp)) return t.common.unknown;
  const seconds = Math.round((timestamp - now) / 1_000);
  const absoluteSeconds = Math.abs(seconds);
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] = absoluteSeconds < 60
    ? [seconds, "second"]
    : absoluteSeconds < 3_600
      ? [Math.round(seconds / 60), "minute"]
      : absoluteSeconds < 86_400
        ? [Math.round(seconds / 3_600), "hour"]
        : [Math.round(seconds / 86_400), "day"];
  return new Intl.RelativeTimeFormat("ru", { numeric: "auto" }).format(value, unit);
}

/** Exact local timestamp retained in the `time` tooltip and accessible name. */
export function formatExactVersionTime(isoDate: string): string {
  const timestamp = Date.parse(isoDate);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(timestamp)
    : t.common.unknown;
}
