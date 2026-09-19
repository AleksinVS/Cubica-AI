"use client";

/**
 * Quiet, non-executable structural preview for web UI authoring content.
 * Selection only reports the source pointer; it never invokes authored UI
 * actions or attempts to resolve game state.
 */
import React, { useEffect, useRef, useState } from "react";

import type {
  EditorWireframeNode,
  EditorWireframeProjection
} from "@/lib/editor-wireframe-projection";

import styles from "./editor-wireframe.module.css";

export interface EditorWireframeSelection {
  readonly sourceFilePath: string;
  readonly sourcePointer: string;
}

export interface EditorWireframeProps {
  readonly projection: EditorWireframeProjection | null;
  readonly selectedScreenId?: string;
  readonly onScreenChange?: (screenId: string) => void;
  readonly selectedSourcePointer?: string;
  readonly onSelect: (selection: EditorWireframeSelection) => void;
}

const KIND_LABELS: Record<EditorWireframeNode["kind"], string> = {
  container: "контейнер",
  text: "текст",
  button: "кнопка",
  metric: "метрика",
  asset: "ресурс",
  card: "карточка",
  unknown: "элемент"
};

export function EditorWireframe({
  projection,
  selectedScreenId,
  onScreenChange,
  selectedSourcePointer,
  onSelect
}: EditorWireframeProps) {
  const entryScreenId = projection?.entryScreenId;
  const fallbackScreenId = projection !== null && entryScreenId != null
    && projection.screens.some((screen) => screen.id === entryScreenId)
    ? entryScreenId
    : projection?.screens[0]?.id ?? "";
  const [localScreenId, setLocalScreenId] = useState(fallbackScreenId);
  const lastInvalidSelectionKey = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (projection === null) {
      setLocalScreenId("");
      lastInvalidSelectionKey.current = undefined;
      return;
    }
    const selectedIsValid = selectedScreenId === undefined
      || projection.screens.some((screen) => screen.id === selectedScreenId);
    if (!selectedIsValid) {
      const key = `${selectedScreenId}\u0000${fallbackScreenId}`;
      if (lastInvalidSelectionKey.current !== key) {
        lastInvalidSelectionKey.current = key;
        setLocalScreenId(fallbackScreenId);
        if (fallbackScreenId !== "") onScreenChange?.(fallbackScreenId);
      }
      return;
    }
    lastInvalidSelectionKey.current = undefined;
    if (!projection.screens.some((screen) => screen.id === localScreenId)) {
      setLocalScreenId(fallbackScreenId);
    }
  }, [fallbackScreenId, localScreenId, onScreenChange, projection, selectedScreenId]);

  if (projection === null) {
    return (
      <section className={styles.canvas} data-testid="editor-wireframe" aria-label="Структурный макет">
        <header className={styles.header}>
          <span className={styles.eyebrow}>Структурный макет</span>
          <strong>Предпросмотр</strong>
        </header>
        <div className={styles.empty} role="status">
          <strong>Структура интерфейса пока не определена</strong>
          <span>Добавьте элементы интерфейса, чтобы увидеть их расположение.</span>
        </div>
      </section>
    );
  }

  const activeScreenId = selectedScreenId !== undefined
    && projection.screens.some((candidate) => candidate.id === selectedScreenId)
    ? selectedScreenId
    : projection.screens.some((screen) => screen.id === localScreenId)
      ? localScreenId
      : fallbackScreenId;
  const screen = projection.screens.find((candidate) => candidate.id === activeScreenId);

  function changeScreen(screenId: string): void {
    setLocalScreenId(screenId);
    onScreenChange?.(screenId);
  }

  return (
    <section className={styles.canvas} data-testid="editor-wireframe" aria-label="Структурный макет">
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Структурный макет</span>
          <strong>{projection.title}</strong>
        </div>
        {projection.screens.length > 0 ? (
          <label className={styles.screenPicker}>
            <span>Экран</span>
            <select
              aria-label="Выбрать экран"
              value={screen?.id ?? ""}
              onChange={(event) => changeScreen(event.currentTarget.value)}
            >
              {projection.screens.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
              ))}
            </select>
          </label>
        ) : null}
      </header>

      {projection.truncated ? (
        <div className={styles.notice} role="status">Структура показана частично: макет ограничен по глубине или размеру.</div>
      ) : null}

      {screen === undefined ? (
        <div className={styles.empty} role="status">
          <strong>Структура интерфейса пока не определена</strong>
          <span>В документе нет доступного экрана для показа.</span>
        </div>
      ) : screen.nodes.length === 0 ? (
        <div className={styles.empty} role="status">
          <strong>В этом экране пока нет элементов</strong>
          <span>Незавершённая структура останется видимой после следующего изменения.</span>
        </div>
      ) : (
        <div className={styles.screen} data-wireframe-screen-id={screen.id}>
          <div className={styles.screenCaption}>{screen.label}</div>
          <div className={styles.tree}>
            {screen.nodes.map((node) => (
              <WireframeNodeView
                key={node.sourcePointer}
                node={node}
                selectedSourcePointer={selectedSourcePointer}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function WireframeNodeView({
  node,
  selectedSourcePointer,
  onSelect
}: {
  readonly node: EditorWireframeNode;
  readonly selectedSourcePointer?: string;
  readonly onSelect: (selection: EditorWireframeSelection) => void;
}) {
  const selected = selectedSourcePointer === node.sourcePointer;
  const className = `${styles.node} ${node.children.length > 0 ? styles.container : styles.leaf}${selected ? ` ${styles.selected}` : ""}`;
  const select = (event: React.SyntheticEvent) => {
    event.stopPropagation();
    onSelect({ sourceFilePath: node.sourceFilePath, sourcePointer: node.sourcePointer });
  };
  const activateKeyboard: React.KeyboardEventHandler<HTMLElement> = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    select(event);
  };
  const content = (
    <>
      <span className={styles.nodeLabel}>{node.label}</span>
      <span className={styles.nodeKind}>{KIND_LABELS[node.kind]}</span>
      {node.displayText !== undefined ? <span className={styles.nodeDetail}>{node.displayText}</span> : null}
      {node.truncated ? <span className={styles.truncationLabel}>продолжение скрыто</span> : null}
    </>
  );

  if (node.children.length > 0) {
    const childrenClassName = node.children.every((child) => child.children.length === 0)
      ? `${styles.children} ${styles.leafGrid}`
      : styles.children;
    return (
      <div className={className}>
        <button
          type="button"
          className={styles.nodeHeader}
          aria-pressed={selected}
          data-wireframe-source-pointer={node.sourcePointer}
          onClick={select}
          onKeyDown={activateKeyboard}
        >
          {content}
        </button>
        <div className={childrenClassName}>
          {node.children.map((child) => (
            <WireframeNodeView
              key={child.sourcePointer}
              node={child}
              selectedSourcePointer={selectedSourcePointer}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={className}
      aria-pressed={selected}
      data-wireframe-source-pointer={node.sourcePointer}
      onClick={select}
      onKeyDown={activateKeyboard}
    >
      {content}
    </button>
  );
}

export default EditorWireframe;
