"use client";

import type { EditorEntity, PreviewEntityDescriptor, PreviewPoint, PreviewRect } from "@cubica/editor-engine";
import React, { useEffect, useRef, useState } from "react";

import type { EntitySourceCapture, ReturnedIntentApplyOutcome } from "./entity-source-text-mode";
import {
  buildMvpElementAuthorPromptChangeSet,
  buildMvpElementNameChangeSet,
  type MvpElementSource
} from "./mvp-element-operations";
import styles from "./mvp-element-editor.module.css";

export interface MvpElementEditorProps {
  readonly source?: MvpElementSource;
  readonly entity?: EditorEntity;
  readonly label: string;
  readonly selectedLayerId?: string;
  readonly bounds?: PreviewRect;
  readonly geometryUnsupportedReason?: string;
  readonly layers?: readonly PreviewEntityDescriptor[];
  readonly layerPoint?: PreviewPoint;
  readonly onSelectLayer?: (layer: PreviewEntityDescriptor, point: PreviewPoint, layers: readonly PreviewEntityDescriptor[]) => void;
  readonly onClose: () => void;
  readonly onDirect: (changeSet: NonNullable<ReturnType<typeof buildMvpElementNameChangeSet>>) => Promise<boolean>;
  readonly onPrompt: (filePath: string, pointer: string, label: string, prompt: string) => Promise<boolean>;
  readonly onCapture: (entity: EditorEntity) => EntitySourceCapture | undefined;
  readonly onApplyYaml: (input: EntitySourceCapture & { returnedText: string }) => Promise<ReturnedIntentApplyOutcome>;
}

function promptRaw(source: MvpElementSource | undefined): string {
  const prompt = source?.value._prompt;
  if (typeof prompt !== "object" || prompt === null || Array.isArray(prompt)) return "";
  const record = prompt as Record<string, unknown>;
  return typeof record.raw === "string" ? record.raw : "";
}

export function MvpElementEditor({ source, entity, label, selectedLayerId, bounds, geometryUnsupportedReason, layers, layerPoint, onSelectLayer, onClose, onDirect, onPrompt, onCapture, onApplyYaml }: MvpElementEditorProps) {
  const [name, setName] = useState(typeof source?.value._label === "string" ? source.value._label : label);
  const [oneOff, setOneOff] = useState("");
  const [authorIntent, setAuthorIntent] = useState(promptRaw(source));
  const [capture, setCapture] = useState(() => entity === undefined ? undefined : onCapture(entity));
  const [yaml, setYaml] = useState(capture?.projectionYaml ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const sourceSnapshotRef = useRef(source === undefined ? undefined : JSON.stringify(source.value));
  const latestSourceRef = useRef(source);
  latestSourceRef.current = source;
  const expectedOwnWriteRef = useRef<{ readonly field: "_label" | "_prompt"; readonly value: unknown } | null>(null);

  function adoptOwnWriteIfVisible(nextSource: MvpElementSource | undefined) {
    const expected = expectedOwnWriteRef.current;
    if (nextSource === undefined || expected === null || JSON.stringify(nextSource.value[expected.field]) !== JSON.stringify(expected.value)) return;
    sourceSnapshotRef.current = JSON.stringify(nextSource.value);
    expectedOwnWriteRef.current = null;
  }

  useEffect(() => {
    adoptOwnWriteIfVisible(source);
  }, [source]);

  const stale = source !== undefined && sourceSnapshotRef.current !== undefined &&
    JSON.stringify(source.value) !== sourceSnapshotRef.current;

  function refresh() {
    sourceSnapshotRef.current = source === undefined ? undefined : JSON.stringify(source.value);
    setName(typeof source?.value._label === "string" ? source.value._label : label);
    setAuthorIntent(promptRaw(source));
    const nextCapture = entity === undefined ? undefined : onCapture(entity);
    setCapture(nextCapture);
    setYaml(nextCapture?.projectionYaml ?? "");
    setNotice("");
  }

  async function commitDirect(kind: "name" | "author") {
    if (source === undefined || busy) return;
    if (stale) { setNotice("Источник изменился. Обновите поля перед сохранением."); return; }
    const changeSet = kind === "name" ? buildMvpElementNameChangeSet(source, name) : buildMvpElementAuthorPromptChangeSet(source, authorIntent);
    if (changeSet === undefined) { setNotice(kind === "name" && name.trim() === "" ? "Название не может быть пустым." : "Изменений нет."); return; }
    setBusy(true);
    try {
      const ok = await onDirect(changeSet);
      if (ok) {
        const write = changeSet.jsonPatches[0]?.operations.at(-1);
        expectedOwnWriteRef.current = { field: kind === "name" ? "_label" : "_prompt", value: write?.op === "remove" ? undefined : write?.op === "add" || write?.op === "replace" ? write.value : undefined };
        adoptOwnWriteIfVisible(latestSourceRef.current);
        setNotice(kind === "name" ? "Название сохранено." : "Авторское описание сохранено.");
      }
      else setNotice("Изменение отклонено. Проверьте сообщение редактора и обновите поля.");
    } finally { setBusy(false); }
  }

  async function submitPrompt() {
    if (source === undefined || oneOff.trim() === "" || busy) return;
    if (stale) { setNotice("Источник изменился. Обновите поля перед запросом."); return; }
    setBusy(true);
    try {
      const ready = await onPrompt(source.filePath, source.pointer, label, oneOff);
      setNotice(ready ? "Вариант подготовлен. Проверьте его в предпросмотре и подтвердите." : "Не удалось подготовить вариант. Проверьте сообщение редактора.");
      if (ready) setOneOff("");
    } finally { setBusy(false); }
  }

  async function applyYaml() {
    if (capture === undefined || busy) return;
    setBusy(true);
    try {
      const result = await onApplyYaml({ ...capture, returnedText: yaml });
      if (result.stale) setNotice("Источник изменился. Обновите структурированный текст.");
      else if (result.applied) { setNotice("Структурированное изменение применено."); }
      else if (result.forwarded) setNotice("Изменение передано агенту на подготовку.");
      else setNotice(result.message ?? "Изменений нет или текст не распознан.");
    } finally { setBusy(false); }
  }

  return (
    <aside className={styles.panel} style={bounds === undefined ? undefined : { top: Math.max(16, Math.min(bounds.y, 160)) }}
      aria-label="Редактор элемента" onPointerDown={(event) => event.stopPropagation()}>
      <div className={styles.header}>
        <span className={styles.eyebrow}>ЭЛЕМЕНТ</span>
        <button type="button" className={styles.close} aria-label="Закрыть редактор элемента" onClick={onClose}>×</button>
      </div>
      <div className={styles.nameRow}>
        <input aria-label="Название элемента" value={name} onChange={(event) => setName(event.target.value)} disabled={source === undefined || busy} />
        <button type="button" onClick={() => void commitDirect("name")} disabled={source === undefined || busy || name.trim() === ""}>Сохранить</button>
      </div>
      {layers !== undefined && layers.length > 1 ? (
        <label className={styles.layerSelect}>Слой
          <select aria-label="Выбрать слой" value={selectedLayerId ?? layers[0]?.entityId ?? ""}
            onChange={(event) => { const layer = layers.find((item) => item.entityId === event.target.value); if (layer !== undefined && layerPoint !== undefined) onSelectLayer?.(layer, layerPoint, layers); }}>
            {layers.map((item) => <option key={item.entityId} value={item.entityId}>{item.label}</option>)}
          </select>
        </label>
      ) : null}
      {source !== undefined && geometryUnsupportedReason !== undefined ? <p className={styles.notice} role="status">{geometryUnsupportedReason}</p> : null}
      {source === undefined ? <p className={styles.notice} role="status">Для этого узла пока нет точного редактируемого источника. Выберите элемент в предпросмотре или дополните структуру интерфейса.</p> : (
        <>
          <section className={styles.block}>
            <h3>Разовая правка</h3>
            <p>Укажите точный новый текст или название в кавычках. Вариант появится для проверки.</p>
            <textarea aria-label="Разовая правка элемента" value={oneOff} onChange={(event) => setOneOff(event.target.value)} placeholder="Например: текст на «Выберите вариант»" />
            <button type="button" onClick={() => void submitPrompt()} disabled={busy || oneOff.trim() === ""}>Подготовить вариант</button>
          </section>
          <section className={styles.block}>
            <h3>Авторское описание</h3>
            <p>Постоянный замысел этого элемента. Сохраняется отдельно от разовой правки.</p>
            <textarea aria-label="Авторское описание элемента" value={authorIntent} onChange={(event) => setAuthorIntent(event.target.value)} placeholder="Что этот элемент должен делать и как выглядеть" />
            <button type="button" onClick={() => void commitDirect("author")} disabled={busy}>Сохранить описание</button>
          </section>
          <section className={styles.block}>
            <h3>Структурированный текст</h3>
            <p>Точный текст источника для сложной правки.</p>
            <textarea className={styles.yaml} aria-label="Структурированный текст элемента" value={yaml} onChange={(event) => setYaml(event.target.value)} disabled={capture === undefined || busy} />
            <button type="button" onClick={() => void applyYaml()} disabled={capture === undefined || busy}>Применить текст</button>
          </section>
        </>
      )}
      {(stale || notice !== "") ? <div className={styles.notice} role="status">{notice || "Источник изменился."}{stale ? <button type="button" onClick={refresh}>Обновить</button> : null}</div> : null}
    </aside>
  );
}
