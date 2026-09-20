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
}

export interface MvpElementDraft {
  readonly text: string;
  readonly baseline: string;
  readonly sourceSnapshot: string | undefined;
  readonly capture: EntitySourceCapture | undefined;
}

function promptRaw(source: MvpElementSource | undefined): string {
  const prompt = source?.value._prompt;
  if (!isPlainJsonObject(prompt)) return "";
  return typeof prompt.raw === "string" ? prompt.raw : "";
}

function documentText(source: MvpElementSource | undefined, label: string, capture: EntitySourceCapture | undefined) {
  return serializeMvpPromptDocument(["", promptRaw(source), `_label: ${JSON.stringify(source?.value._label ?? label)}\n${capture?.projectionYaml ?? ""}`]);
}

export function MvpElementEditor({ drafts, source, entity, label, selectedLayerId, bounds, geometryUnsupportedReason, layers = [], layerPoint, onSelectLayer, onSelectScope, onClose, onCapture, onSave, onSavePrototype }: MvpElementEditorProps) {
  const draftKey = source === undefined ? undefined : `${source.filePath}#${source.pointer}`;
  const retained = draftKey === undefined ? undefined : drafts?.get(draftKey);
  const [capture, setCapture] = useState(() => retained?.capture ?? (entity === undefined ? undefined : onCapture(entity)));
  const [draft, setDraft] = useState(() => retained?.text ?? documentText(source, label, capture));
  const [baseline, setBaseline] = useState(() => retained?.baseline ?? draft);
  const sourceSnapshot = useRef(retained === undefined ? JSON.stringify(source?.value) : retained.sourceSnapshot);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showLayers, setShowLayers] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const hold = useRef<ReturnType<typeof setTimeout>>();
  const held = useRef(false);
  const point = layerPoint ?? { x: bounds?.x ?? 60, y: bounds?.y ?? 64 };
  const stale = sourceSnapshot.current !== JSON.stringify(source?.value);

  useEffect(() => {
    if (!stale || draft !== baseline) return;
    const nextCapture = entity === undefined ? undefined : onCapture(entity);
    const text = documentText(source, label, nextCapture);
    sourceSnapshot.current = JSON.stringify(source?.value);
    setCapture(nextCapture);
    setDraft(text);
    setBaseline(text);
  }, [source, entity, onCapture, label, stale, draft, baseline]);
  useEffect(() => () => { if (hold.current !== undefined) clearTimeout(hold.current); }, []);
  // Rebuilding the preview clears visual selection; reselecting the same source restores its draft.
  useEffect(() => {
    if (draftKey !== undefined) drafts?.set(draftKey, { text: draft, baseline, capture, sourceSnapshot: sourceSnapshot.current });
  }, [draftKey, drafts, draft, baseline, capture]);

  async function save(asTemplate = false) {
    if (source === undefined || busy) return;
    const parsed = parseMvpPromptDocument(draft);
    if (!parsed.ok) { setNotice(parsed.message); return; }
    if (stale) { setNotice("Элемент изменился. Скопируйте черновик и откройте элемент заново, чтобы не затереть изменения."); return; }
    setBusy(true);
    setShowTemplate(false);
    try {
      if (asTemplate) {
        if (draft !== baseline) { setNotice("Сначала сохраните изменения элемента, затем сохраните его как шаблон."); return; }
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

  return <MvpFloatingPrompt point={point} avoid={bounds} width={compactPromptWidth(draft, 220)} label="Редактор элемента">
    <button type="button" className={styles.textHeader} onClick={() => setShowLayers((open) => !open)} aria-label={`Слои: ${label}`} aria-expanded={showLayers}>{label}</button>
    <MvpPromptTextarea className={styles.unifiedText} value={draft} onChange={setDraft} disabled={source === undefined || busy} />
    <button type="button" className={styles.promptClose} aria-label="Закрыть редактор элемента" title="Закрыть" onClick={() => { if (draftKey !== undefined) drafts?.delete(draftKey); onClose(); }}>×</button>
    <button type="button" className={styles.promptSave} aria-label="Сохранить элемент" title="Сохранить; удерживайте для сохранения как шаблона" disabled={source === undefined || busy}
      onPointerDown={() => { held.current = false; hold.current = setTimeout(() => { held.current = true; setShowTemplate(true); }, 550); }}
      onPointerUp={() => { if (hold.current !== undefined) clearTimeout(hold.current); }}
      onPointerCancel={() => { if (hold.current !== undefined) clearTimeout(hold.current); }}
      onContextMenu={(event) => { event.preventDefault(); setShowTemplate(true); }}
      onClick={() => { if (!held.current) void save(); held.current = false; }}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 3h12l4 4v14H3V3h2zm2 0v7h10V3M7 21v-7h10v7" /></svg>
    </button>
    {showTemplate ? <button type="button" className={styles.templateMenu} disabled={onSavePrototype === undefined || busy} onClick={() => void save(true)}>Сохранить как шаблон</button> : null}
    {showLayers ? <div className={styles.layerList} role="listbox" aria-label="Слои элемента" style={{ top: 24, left: 2 }}>
      {layers.map((layer) => <button type="button" key={layer.entityId} role="option" aria-selected={selectedLayerId === layer.entityId} onClick={() => { onSelectLayer?.(layer, point, layers); setShowLayers(false); }}>{layer.label}</button>)}
      {onSelectScope !== undefined ? <><button type="button" role="option" aria-selected={false} onClick={() => { onSelectScope("page", point); setShowLayers(false); }}>Страница</button><button type="button" role="option" aria-selected={false} onClick={() => { onSelectScope("game", point); setShowLayers(false); }}>Игра</button></> : null}
    </div> : null}
    {notice !== "" || geometryUnsupportedReason !== undefined ? <p className={styles.inlineNotice} role="status">{notice || geometryUnsupportedReason}</p> : null}
  </MvpFloatingPrompt>;
}
