"use client";

/**
 * Entity refactor dialogs (design-spec §3.2; editor-preview-first-ux §9.1, §4.2).
 *
 * Two small modal dialogs that gate the DANGEROUS entity-level refactor
 * operations (ADR-057 §4.5):
 *
 *   - `DeleteEntityDialog` — the "область действия" (scope) dialog: it lists the
 *     entity's facets ("фасеты") and its incoming references ("входящие ссылки")
 *     and offers three choices — cancel, delete-and-clean-references, or
 *     retarget-references-to another entity. Until Save there is no irreversible
 *     loss (session journal / worktree), so no confirmation beyond the ADR-047
 *     approval envelope the controller records is required.
 *   - `RenameEntityIdDialog` — renames an entity `id`. It is ALWAYS dangerous, so
 *     the controller wraps the confirm in an approval envelope; an invalid or
 *     already-used id surfaces as a refusal message here.
 *
 * Both are PURELY presentational: they own no authoring data, build no ChangeSet
 * and run no risk/approval logic — every decision is reported through callbacks,
 * and the controller (`useEditorWorkspace`) owns the builders, the risk
 * classification and the approval-envelope gate. All user-facing text — domain
 * labels AND screen-reader labels — is Russian, from the chrome locale
 * (@/lib/locale, TSK-20260708).
 */
import React, { useState } from "react";

import { editorRu as t } from "@/lib/locale";

/** One facet source line shown in the delete scope dialog. */
export interface EntityFacetSummary {
  /** Facet bucket label, for example «Смысл», «Содержание», «Вид · web». */
  readonly label: string;
  /** `"<filePath>#<pointer>"` of the facet source (for a hover title). */
  readonly source: string;
}

/** One incoming reference line shown in the delete scope dialog. */
export interface IncomingReferenceSummary {
  /** The reference field key that carried the link, for example `actionId`. */
  readonly key: string;
  /** `"<filePath>#<pointer>"` of the reference field. */
  readonly source: string;
}

/** A candidate target for the "Перенацелить ссылки на…" choice. */
export interface RetargetOption {
  readonly id: string;
  readonly label: string;
}

export interface DeleteEntityDialogProps {
  readonly entityLabel: string;
  readonly facets: readonly EntityFacetSummary[];
  readonly incomingReferences: readonly IncomingReferenceSummary[];
  /** Existing entities the references may be retargeted to (excludes this entity). */
  readonly retargetOptions: readonly RetargetOption[];
  readonly onCancel: () => void;
  /** «Удалить и вычистить ссылки» — delete the entity and remove every incoming reference. */
  readonly onDeleteAndClean: () => void;
  /** «Перенацелить ссылки на…» — delete the entity and repoint every reference. */
  readonly onRetarget: (retargetTo: string) => void;
}

export function DeleteEntityDialog({
  entityLabel,
  facets,
  incomingReferences,
  retargetOptions,
  onCancel,
  onDeleteAndClean,
  onRetarget
}: DeleteEntityDialogProps) {
  const hasIncoming = incomingReferences.length > 0;
  const [retargetTo, setRetargetTo] = useState<string>(retargetOptions[0]?.id ?? "");

  return (
    <RefactorDialogShell ariaLabel={t.refactorDialog.deleteAria} title="Удалить сущность" onCancel={onCancel}>
      <p className="entity-refactor-lead">
        Удалить <strong>{entityLabel}</strong>?
      </p>

      <section className="entity-refactor-section" aria-label={t.refactorDialog.facetsAria}>
        <h4>Фасеты сущности</h4>
        {facets.length === 0 ? (
          <p className="entity-refactor-empty">Нет фасетов.</p>
        ) : (
          <ul>
            {facets.map((facet) => (
              <li key={facet.source} title={facet.source}>
                {facet.label}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="entity-refactor-section" aria-label={t.refactorDialog.incomingAria}>
        <h4>Входящие ссылки{hasIncoming ? ` (${incomingReferences.length})` : ""}</h4>
        {hasIncoming ? (
          <ul>
            {incomingReferences.map((reference) => (
              <li key={reference.source} title={reference.source}>
                <code>{reference.key}</code> — {reference.source}
              </li>
            ))}
          </ul>
        ) : (
          <p className="entity-refactor-empty">Нет входящих ссылок.</p>
        )}
      </section>

      <div className="entity-refactor-actions">
        <button type="button" className="entity-refactor-cancel" onClick={onCancel}>
          Отменить
        </button>
        <button type="button" className="entity-refactor-danger" data-testid="entity-delete-clean" onClick={onDeleteAndClean}>
          {hasIncoming ? "Удалить и вычистить ссылки" : "Удалить"}
        </button>
      </div>

      {hasIncoming ? (
        <div className="entity-refactor-retarget" aria-label={t.refactorDialog.retargetAria}>
          <label>
            Перенацелить ссылки на…
            <select
              aria-label={t.refactorDialog.retargetTargetAria}
              data-testid="entity-retarget-target"
              value={retargetTo}
              onChange={(event) => setRetargetTo(event.target.value)}
            >
              {retargetOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} ({option.id})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="entity-refactor-retarget-confirm"
            data-testid="entity-retarget-confirm"
            disabled={retargetTo === ""}
            onClick={() => onRetarget(retargetTo)}
          >
            Перенацелить и удалить
          </button>
        </div>
      ) : null}
    </RefactorDialogShell>
  );
}

export interface RenameEntityIdDialogProps {
  readonly entityLabel: string;
  readonly currentId: string;
  /** Slug seed for the new-id input (from the current label / id). */
  readonly suggestedId: string;
  /** A refusal message from a rejected `ok: false` builder result. */
  readonly error?: string;
  readonly onCancel: () => void;
  readonly onConfirm: (newId: string) => void;
}

export function RenameEntityIdDialog({ entityLabel, currentId, suggestedId, error, onCancel, onConfirm }: RenameEntityIdDialogProps) {
  const [newId, setNewId] = useState<string>(suggestedId);
  const trimmed = newId.trim();
  const unchanged = trimmed === currentId;

  return (
    <RefactorDialogShell ariaLabel={t.refactorDialog.renameAria} title="Переименовать id" onCancel={onCancel}>
      <p className="entity-refactor-lead">
        Переименовать id сущности <strong>{entityLabel}</strong> (сейчас <code>{currentId}</code>). Все входящие ссылки будут
        обновлены.
      </p>
      <label className="entity-refactor-field">
        Новый id
        <input
          aria-label={t.refactorDialog.newIdAria}
          data-testid="entity-rename-input"
          value={newId}
          autoFocus
          onChange={(event) => setNewId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && trimmed !== "" && !unchanged) {
              onConfirm(trimmed);
            }
          }}
        />
      </label>
      {error !== undefined ? (
        <p className="entity-refactor-error" role="alert" data-testid="entity-rename-error">
          {error}
        </p>
      ) : null}
      <div className="entity-refactor-actions">
        <button type="button" className="entity-refactor-cancel" onClick={onCancel}>
          Отменить
        </button>
        <button
          type="button"
          className="entity-refactor-danger"
          data-testid="entity-rename-confirm"
          disabled={trimmed === "" || unchanged}
          onClick={() => onConfirm(trimmed)}
        >
          Переименовать
        </button>
      </div>
    </RefactorDialogShell>
  );
}

/** Shared modal shell: a dimmed backdrop plus a titled card; Esc / backdrop cancels. */
function RefactorDialogShell({
  ariaLabel,
  title,
  onCancel,
  children
}: {
  readonly ariaLabel: string;
  readonly title: string;
  readonly onCancel: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <div
      className="entity-refactor-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onCancel();
        }
      }}
    >
      <section className="entity-refactor-dialog" role="dialog" aria-modal="true" aria-label={ariaLabel}>
        <header className="entity-refactor-head">
          <strong>{title}</strong>
          <button type="button" className="entity-refactor-close" aria-label={t.refactorDialog.closeAria} onClick={onCancel}>
            ✕
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
