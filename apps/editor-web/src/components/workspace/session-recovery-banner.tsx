"use client";

/**
 * Recovery notice for a reused editor session with an unsaved draft.
 *
 * The server-owned session summary is the evidence that the worktree already
 * existed and still contains author changes. This component never mutates that
 * draft: dismissing the notice only hides the explanation for this browser
 * visit, while the existing files continue to be the editor's source.
 */
import { editorRu as t } from "@/lib/locale";
import React from "react";

export interface SessionRecoveryBannerProps {
  readonly changedPaths: readonly string[];
  readonly onDismiss: () => void;
}

export function SessionRecoveryBanner({ changedPaths, onDismiss }: SessionRecoveryBannerProps) {
  if (changedPaths.length === 0) {
    return null;
  }

  return (
    <section className="session-recovery-banner" role="status" data-testid="session-recovery-banner">
      <div>
        <strong>{t.sessionRecovery.title}</strong>
        <p>{t.sessionRecovery.body(changedPaths.length)}</p>
        <ul aria-label={t.sessionRecovery.filesAria}>
          {changedPaths.slice(0, 4).map((path) => <li key={path}>{path}</li>)}
        </ul>
        {changedPaths.length > 4 ? <small>{t.sessionRecovery.moreFiles(changedPaths.length - 4)}</small> : null}
      </div>
      <button type="button" onClick={onDismiss}>{t.sessionRecovery.dismiss}</button>
    </section>
  );
}
