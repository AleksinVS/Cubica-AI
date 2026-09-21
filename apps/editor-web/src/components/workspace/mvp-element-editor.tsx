"use client";

import { isPlainJsonObject, type EditorEntity, type PreviewEntityDescriptor, type PreviewPoint, type PreviewRect } from "@cubica/editor-engine";
import React, { useEffect, useRef, useState } from "react";
import type { EntitySourceCapture } from "./entity-source-text-mode";
import type { MvpElementSource } from "./mvp-element-operations";
import { MvpFloatingPrompt, compactPromptWidth } from "./mvp-floating-prompt";
import { MvpPromptTextarea } from "./mvp-prompt-textarea";
import { parseMvpPromptDocument, serializeMvpPromptDocument } from "./mvp-prompt-document";
import styles from "./mvp-element-editor.module.css";

export interface MvpElementEditorProps {
  readonly drafts?: Map<string, MvpElementDraft>;
  readonly source?: MvpElementSource;
  readonly entity?: EditorEntity;
  readonly label: string;
  readonly selectedLayerId?: string;
  readonly bounds?: PreviewRect;
  readonly geometryUnsupportedReason?: string;
  readonly layers?: readonly PreviewEntityDescriptor[];
  readonly layerPoint?: PreviewPoint;
  readonly onSelectLayer?: (layer: PreviewEntityDescriptor, point: PreviewPoint, layers: readonly PreviewEntityDescriptor[]) => void;
  readonly onSelectScope?: (scope: "game" | "page", point: PreviewPoint) => void;
  readonly onClose: () => void;
  readonly onCapture: (entity: EditorEntity) => EntitySourceCapture | undefined;
  readonly onSave: (input: { source: MvpElementSource; capture?: EntitySourceCapture; oneOff: string; authorIntent: string; yaml: string }) => Promise<{ ok: boolean; pending?: boolean; message: string }>;
  readonly onSavePrototype?: (source: MvpElementSource) => Promise<{ ok: boolean; message: string }>;
  readonly editingPrototype?: { readonly name: string; readonly affectedCount: number; readonly overriddenCount?: number };
  readonly onEditPrototype?: () => void;
  readonly onReturnToInstance?: () => void;
  readonly onResetOverrides?: () => Promise<{ ok: boolean; message: string }>;
  readonly contextKey?: string;
  readonly localChildOverrides?: boolean;
}

export interface MvpElementDraft {
  readonly text: string;
  readonly baseline: string;
  readonly sourceSnapshot: string | undefined;
  readonly capture: EntitySourceCapture | undefined;
  readonly contextKey?: string;
  readonly isPrototype?: boolean;
}

function promptRaw(source: MvpElementSource | undefined, editingPrototype: boolean): string {
  const prompt = source?.value[editingPrototype ? "_promptTemplate" : "_prompt"];
  if (!isPlainJsonObject(prompt)) return "";
  if (typeof prompt.staticText === "string") return prompt.staticText;
  return typeof prompt.raw === "string" ? prompt.raw : "";
}

function documentText(source: MvpElementSource | undefined, capture: EntitySourceCapture | undefined, editingPrototype: boolean) {
  return serializeMvpPromptDocument(["", promptRaw(source, editingPrototype), capture?.projectionYaml ?? ""]);
}

export function MvpElementEditor({ drafts, source, entity, label, selectedLayerId, bounds, geometryUnsupportedReason, layers = [], layerPoint, onSelectLayer, onSelectScope, onClose, onCapture, onSave, onSavePrototype, editingPrototype, onEditPrototype, onReturnToInstance, onResetOverrides, contextKey, localChildOverrides }: MvpElementEditorProps) {
  const isPrototype = editingPrototype !== undefined;
  const draftKey = source === undefined ? undefined : `${source.filePath}#${source.pointer}`;
  const retained = draftKey === undefined ? undefined : drafts?.get(draftKey);
  const [capture, setCapture] = useState(() => retained?.capture ?? (entity === undefined ? undefined : onCapture(entity)));
  const [draft, setDraft] = useState(() => retained?.text ?? documentText(source, capture, isPrototype));
  const [baseline, setBaseline] = useState(() => retained?.baseline ?? draft);
  const [draftContextKey, setDraftContextKey] = useState<string | undefined>(() => retained?.contextKey ?? contextKey);
  const [draftMode, setDraftMode] = useState(() => retained?.isPrototype ?? isPrototype);
  const sourceSnapshot = useRef(retained === undefined ? JSON.stringify(source?.value) : retained.sourceSnapshot);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showLayers, setShowLayers] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const hold = useRef<ReturnType<typeof setTimeout>>();
  const held = useRef(false);
  const point = layerPoint ?? { x: bounds?.x ?? 60, y: bounds?.y ?? 64 };
  const stale = sourceSnapshot.current !== JSON.stringify(source?.value);
  const contextStale = draft !== baseline && (draftContextKey !== contextKey || draftMode !== isPrototype);

  useEffect(() => {
    if (draft !== baseline || (!stale && draftContextKey === contextKey && draftMode === isPrototype)) return;
    const nextCapture = entity === undefined ? undefined : onCapture(entity);
    const text = documentText(source, nextCapture, isPrototype);
    sourceSnapshot.current = JSON.stringify(source?.value);
    setCapture(nextCapture);
    setDraft(text);
    setBaseline(text);
    setDraftContextKey(contextKey);
    setDraftMode(isPrototype);
  }, [source, entity, onCapture, isPrototype, stale, draft, baseline, contextKey, draftContextKey, draftMode]);
  useEffect(() => () => { if (hold.current !== undefined) clearTimeout(hold.current); }, []);
  // Rebuilding the preview clears visual selection; reselecting the same source restores its draft.
  useEffect(() => {
    if (draftKey === undefined) return;
    if (draft === baseline) drafts?.delete(draftKey);
    else drafts?.set(draftKey, { text: draft, baseline, capture, sourceSnapshot: sourceSnapshot.current, contextKey: draftContextKey, isPrototype: draftMode });
  }, [draftKey, drafts, draft, baseline, capture, draftContextKey, draftMode]);

  async function save(asTemplate = false) {
    if (source === undefined || busy) return;
    const parsed = parseMvpPromptDocument(draft);
    if (!parsed.ok) { setNotice(parsed.message); return; }
    if (stale) { setNotice("Элемент изменился. Скопируйте черновик и откройте элемент заново, чтобы не затереть изменения."); return; }
    if (contextStale) { setNotice("Контекст прототипа или экземпляра изменился. Откройте нужный контекст заново, чтобы не перенаправить правку."); return; }
    setBusy(true);
    setShowTemplate(false);
    try {
      if (asTemplate) {
        if (draft !== baseline) { setNotice(`Сначала сохраните изменения элемента, затем сохраните его как ${isPrototype ? "новый прототип" : "шаблон"}.`); return; }
        const result = await onSavePrototype?.(source);
        if (result !== undefined) setNotice(result.message);
      } else {
        const [oneOff, authorIntent, yaml] = parsed.sections;
        const result = await onSave({ source, capture, oneOff, authorIntent, yaml });
        setNotice(result.message);
        if (result.ok && !result.pending) setBaseline(draft);
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось сохранить. Текст остаётся в поле."); }
    finally { setBusy(false); }
  }

  async function resetOverrides() {
    if (onResetOverrides === undefined || busy) return;
    setBusy(true);
    setShowLayers(false);
    try {
      const result = await onResetOverrides();
      setNotice(result.message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось вернуть значения прототипа.");
    } finally {
      setBusy(false);
    }
  }

  const contextNotice = contextStale
    ? "Контекст прототипа или экземпляра изменился. Черновик сохранён; откройте нужный контекст заново, чтобы не перенаправить правку."
    : undefined;
  const impactNotice = editingPrototype === undefined ? undefined : [
    `Затронет наследников: ${editingPrototype.affectedCount}`,
    editingPrototype.overriddenCount === undefined ? undefined : `локально переопределено: ${editingPrototype.overriddenCount}`
  ].filter((part): part is string => part !== undefined).join("; ");
  const displayNotice = [notice, contextNotice].filter((part): part is string => part !== undefined && part !== "").join(" ") || geometryUnsupportedReason ||
    (localChildOverrides ? "Вложенные элементы заданы локально и не обновляются из прототипа группы." : undefined);

  return <MvpFloatingPrompt point={point} avoid={bounds} width={compactPromptWidth(draft, 220)} label="Редактор элемента">
    {editingPrototype !== undefined ? <div className={styles.prototypeHeader}>
      <span className={styles.prototypeLabel}>Прототип: {editingPrototype.name}</span>
      <button type="button" className={styles.prototypeBack} aria-label="Вернуться к экземпляру" title="Вернуться к экземпляру" onClick={() => onReturnToInstance?.()}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M19 12H5m7-7-7 7 7 7" /></svg>
      </button>
      <span className={styles.prototypeImpact}>{impactNotice}</span>
    </div> : <button type="button" className={styles.textHeader} onClick={() => setShowLayers((open) => !open)} aria-label={`Слои: ${label}`} aria-expanded={showLayers}>{label}</button>}
    <MvpPromptTextarea className={styles.unifiedText} value={draft} onChange={setDraft} disabled={source === undefined || busy} />
    <button type="button" className={styles.promptClose} aria-label="Закрыть редактор элемента" title="Закрыть" onClick={() => { if (draftKey !== undefined) drafts?.delete(draftKey); onClose(); }}>×</button>
    <button type="button" className={styles.promptSave} aria-label="Сохранить элемент" title={`Сохранить; удерживайте для ${isPrototype ? "сохранения как нового прототипа" : "сохранения как шаблона"}`} disabled={source === undefined || busy}
      onPointerDown={() => { held.current = false; hold.current = setTimeout(() => { held.current = true; setShowTemplate(true); }, 550); }}
      onPointerUp={() => { if (hold.current !== undefined) clearTimeout(hold.current); }}
      onPointerCancel={() => { if (hold.current !== undefined) clearTimeout(hold.current); }}
      onContextMenu={(event) => { event.preventDefault(); setShowTemplate(true); }}
      onClick={() => { if (!held.current) void save(); held.current = false; }}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 3h12l4 4v14H3V3h2zm2 0v7h10V3M7 21v-7h10v7" /></svg>
    </button>
    {showTemplate ? <button type="button" className={styles.templateMenu} disabled={onSavePrototype === undefined || busy} onClick={() => void save(true)}>{isPrototype ? "Сохранить как новый прототип" : "Сохранить как шаблон"}</button> : null}
    {showLayers && !isPrototype ? <div className={styles.layerList} role="listbox" aria-label="Слои элемента" style={{ top: 24, left: 2 }}>
      {layers.map((layer) => <button type="button" key={layer.entityId} role="option" aria-selected={selectedLayerId === layer.entityId} onClick={() => { onSelectLayer?.(layer, point, layers); setShowLayers(false); }}>{layer.label}</button>)}
      {onSelectScope !== undefined ? <><button type="button" role="option" aria-selected={false} onClick={() => { onSelectScope("page", point); setShowLayers(false); }}>Страница</button><button type="button" role="option" aria-selected={false} onClick={() => { onSelectScope("game", point); setShowLayers(false); }}>Игра</button></> : null}
      {onEditPrototype !== undefined ? <button type="button" role="option" aria-selected={false} onClick={() => { onEditPrototype(); setShowLayers(false); }}>Редактировать прототип</button> : null}
      {onResetOverrides !== undefined ? <button type="button" role="option" aria-selected={false} disabled={busy} onClick={() => void resetOverrides()}>Вернуть значения прототипа</button> : null}
    </div> : null}
    {displayNotice !== undefined && displayNotice !== "" ? <p className={styles.inlineNotice} role="status">{displayNotice}</p> : null}
  </MvpFloatingPrompt>;
}
