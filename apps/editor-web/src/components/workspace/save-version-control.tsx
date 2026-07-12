"use client";

/**
 * One-click Save with an optional, non-modal author comment.
 *
 * The primary action never forces an extra step. Authors who need context can
 * expand the adjacent disclosure, review the deterministic summary, add a
 * bounded comment, and then use the same Save button.
 */
import { EDITOR_VERSION_COMMENT_MAX_LENGTH } from "@/lib/editor-version-contracts";
import { editorRu as t } from "@/lib/locale";
import React from "react";

export interface SaveVersionControlProps {
  readonly disabled: boolean;
  readonly saving: boolean;
  readonly blockedTitle?: string;
  readonly proposedSummary: string;
  readonly authorComment: string;
  readonly onAuthorCommentChange: (comment: string) => void;
  readonly onSave: () => void;
}

export function SaveVersionControl({
  disabled,
  saving,
  blockedTitle,
  proposedSummary,
  authorComment,
  onAuthorCommentChange,
  onSave
}: SaveVersionControlProps) {
  return (
    <div className="save-version-control">
      <button type="button" onClick={onSave} title={blockedTitle} disabled={disabled} data-testid="save-version-action">
        {saving ? t.toolbar.saving : t.toolbar.save}
      </button>
      <details className="save-version-details">
        <summary aria-label={t.toolbar.saveCommentAria} title={t.toolbar.saveComment}>{t.toolbar.saveComment}</summary>
        <div className="save-version-popover">
          <span>{t.toolbar.saveSummary}</span>
          <strong>{proposedSummary}</strong>
          <label>
            {t.toolbar.saveComment}
            <textarea
              aria-label={t.toolbar.saveCommentAria}
              maxLength={EDITOR_VERSION_COMMENT_MAX_LENGTH}
              placeholder={t.toolbar.saveCommentPlaceholder}
              value={authorComment}
              onChange={(event) => onAuthorCommentChange(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !disabled) onSave();
              }}
            />
          </label>
          <small>{t.toolbar.saveCommentLimit(EDITOR_VERSION_COMMENT_MAX_LENGTH - authorComment.length)}</small>
        </div>
      </details>
    </div>
  );
}
