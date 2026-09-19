import React, { useEffect, useMemo, useRef, useState } from "react";
import type { EditorChangeSet, EditorEntity, EditorEntityProjectionDocument } from "@cubica/editor-engine";

import styles from "./mvp-rules-panel.module.css";
import {
  buildMvpRuleChangeSet,
  readPreparedRuleText,
  readRuleSource,
  readRuleText,
  ruleEntities,
  rulesSourceRevision
} from "./mvp-rules-panel-helpers.ts";

export interface MvpRulesPanelProps {
  readonly entities: readonly EditorEntity[];
  readonly documents: readonly EditorEntityProjectionDocument[];
  readonly selectedEntityId?: string;
  readonly onSelectEntity: (entityId: string) => void;
  readonly onApply: (changeSet: EditorChangeSet) => Promise<boolean>;
  readonly preparedDocuments?: readonly { readonly filePath: string; readonly text: string }[];
  readonly disabled?: boolean;
}

interface RuleDraft {
  readonly entityId: string | undefined;
  readonly value: string;
  readonly baseline: string;
  readonly revision: string;
}

function draftFor(entity: EditorEntity | undefined, documents: readonly EditorEntityProjectionDocument[]): RuleDraft {
  const filePath = entity?.primarySource.filePath;
  return {
    entityId: entity?.entityId,
    value: entity === undefined ? "" : readRuleText(entity, documents),
    baseline: entity === undefined ? "" : readRuleText(entity, documents),
    revision: rulesSourceRevision(documents, filePath)
  };
}

export function MvpRulesPanel({
  entities,
  documents,
  selectedEntityId,
  onSelectEntity,
  onApply,
  preparedDocuments = [],
  disabled = false
}: MvpRulesPanelProps) {
  const availableEntities = useMemo(() => ruleEntities(entities), [entities]);
  const defaultEntity = availableEntities.find((entity) => entity.kind === "game-root") ?? availableEntities[0];
  const [uncontrolledEntityId, setUncontrolledEntityId] = useState<string | undefined>(defaultEntity?.entityId);
  const activeEntityId = selectedEntityId ?? uncontrolledEntityId;
  const activeEntity = availableEntities.find((entity) => entity.entityId === activeEntityId) ?? defaultEntity;
  const sourceRevision = rulesSourceRevision(documents, activeEntity?.primarySource.filePath);
  const latestSourceRevisionRef = useRef(sourceRevision);
  latestSourceRevisionRef.current = sourceRevision;
  const [draft, setDraft] = useState<RuleDraft>(() => draftFor(activeEntity, documents));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (draft.entityId !== activeEntity?.entityId) {
      setDraft(draftFor(activeEntity, documents));
      setError(undefined);
    } else if (draft.value === draft.baseline && draft.revision !== sourceRevision) {
      // A clean panel follows an external reload; only a dirty draft needs stale protection.
      setDraft(draftFor(activeEntity, documents));
    }
  }, [activeEntity?.entityId, documents, draft.baseline, draft.entityId, draft.revision, draft.value, sourceRevision]);

  const dirty = draft.value !== draft.baseline;
  const stale = dirty && draft.revision !== sourceRevision;
  const candidateText = activeEntity === undefined ? undefined : readPreparedRuleText(activeEntity, preparedDocuments);
  const source = activeEntity === undefined ? undefined : readRuleSource(activeEntity, documents);
  const changeSet = source === undefined || stale ? undefined : buildMvpRuleChangeSet(source, draft.value);

  function selectEntity(entityId: string): void {
    setUncontrolledEntityId(entityId);
    onSelectEntity(entityId);
  }

  function reloadDraft(): void {
    setDraft(draftFor(activeEntity, documents));
    setError(undefined);
  }

  async function applyRule(): Promise<void> {
    if (changeSet === undefined || saving || disabled || stale) return;
    setSaving(true);
    setError(undefined);
    try {
      const applied = await onApply(changeSet);
      if (applied) {
        // The parent may publish the new projection after this promise resolves. Rebase the
        // local draft at the current revision so the next keystroke is not falsely stale.
        setDraft({ entityId: activeEntity?.entityId, value: draft.value, baseline: draft.value, revision: latestSourceRevisionRef.current });
      }
      else setError("Изменение не применено.");
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "Изменение не применено.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className={styles.panel} aria-label="Правила" data-testid="mvp-rules-panel">
      <div className={styles.heading}>
        <h2>Правила</h2>
        <span>Авторское намерение</span>
      </div>
      {availableEntities.length === 0 ? (
        <p className={styles.empty}>Нет доступных игровых элементов для правила.</p>
      ) : (
        <>
          <div className={styles.field}>
            <label htmlFor="mvp-rules-entity">Элемент</label>
            <select
              id="mvp-rules-entity"
              className={styles.select}
              value={activeEntity?.entityId ?? ""}
              onChange={(event) => selectEntity(event.target.value)}
              disabled={disabled || saving}
            >
              {availableEntities.map((entity) => <option key={entity.entityId} value={entity.entityId}>{entity.label}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="mvp-rules-text">Правило для элемента «{activeEntity?.label ?? ""}»</label>
            <textarea
              id="mvp-rules-text"
              data-testid="mvp-rules-text"
              className={styles.textarea}
              aria-describedby="mvp-rules-help"
              value={draft.value}
              onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))}
              disabled={disabled || saving || stale}
            />
            <p id="mvp-rules-help" className={styles.help}>Текст сохраняется как авторское описание; пустой текст удаляет существующее описание.</p>
          </div>
          {candidateText !== undefined ? (
            <div className={styles.candidate}>
              <span className={styles.candidateLabel}>Подготовленный вариант</span>
              <textarea data-testid="mvp-rules-candidate" className={styles.textarea} aria-label="Подготовленный вариант правила" value={candidateText} readOnly />
              <p className={styles.help}>Вариант подготовлен диалогом и не записан в проект.</p>
            </div>
          ) : null}
          {stale ? (
            <p className={styles.notice} role="alert">
              Правило изменилось после начала черновика. Перезагрузите его, чтобы увидеть актуальный текст и продолжить.
              <br />
              <button type="button" className={styles.button} onClick={reloadDraft}>Перезагрузить</button>
            </p>
          ) : null}
          {error !== undefined ? <p className={styles.notice} role="alert">{error}</p> : null}
          <div className={styles.actions}>
            <button type="button" className={`${styles.button} ${styles.buttonPrimary}`} onClick={() => void applyRule()} disabled={disabled || saving || stale || changeSet === undefined}>
              {saving ? "Сохраняю…" : "Сохранить"}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
