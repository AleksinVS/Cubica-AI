"use client";

/**
 * Presentational Telegram structural viewer for ordinary UI authoring content.
 *
 * It deliberately does not imitate Telegram chrome or execute button commands.
 * Every card remains an editor selection target and carries the source pointer
 * produced by the framework-free projection.
 */
import type { PreviewEntityDescriptor, PreviewRendererAdapter } from "@cubica/editor-engine";
import React, { useLayoutEffect, useRef, useState } from "react";

import { PreviewSelectionOverlay } from "@/components/preview-selection-overlay";
import { createDomPreviewAdapter } from "@/lib/preview-dom-adapter";
import type { TelegramStructuralAction, TelegramStructuralMessage, TelegramStructuralProjection } from "@/lib/telegram-structural-projection";

export interface TelegramStructuralSelection {
  readonly id: string;
  readonly label: string;
  readonly sourcePointer: string;
  readonly sourceFilePath: string;
}

export interface TelegramStructuralViewerProps {
  readonly projection: TelegramStructuralProjection | null;
  readonly selectedSourcePointer?: string;
  readonly onSelect: (selection: TelegramStructuralSelection) => void;
  /** Resolves an authoring node to the stable project entity shown by the inspector. */
  readonly resolveEditorEntityId?: (sourceFilePath: string, sourcePointer: string) => string | undefined;
  /** Enables point and rectangle selection through the shared renderer contract. */
  readonly inspectMode?: boolean;
  /** A diagnostic-originated notice explaining why this entity has no Telegram view. */
  readonly missingViewCallout?: { readonly entityId: string; readonly label: string } | null;
  /** Test/integration seam exposing the same adapter used by the selection layer. */
  readonly onAdapterChange?: (adapter: PreviewRendererAdapter | null) => void;
}

export function TelegramStructuralViewer({
  projection,
  selectedSourcePointer,
  onSelect,
  resolveEditorEntityId,
  inspectMode = false,
  missingViewCallout = null,
  onAdapterChange
}: TelegramStructuralViewerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const adapterRef = useRef<PreviewRendererAdapter | null>(null);
  const [entities, setEntities] = useState<readonly PreviewEntityDescriptor[]>([]);

  // The structural viewer is same-origin DOM, so it can use the existing DOM
  // adapter directly. Bounds are refreshed after layout, scrolling, and window
  // resizing; cleanup mirrors the React effect guidance for external listeners.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const adapter = createDomPreviewAdapter(root, { coordinateRoot: root });
    adapterRef.current = adapter;
    const refresh = () => setEntities(adapter.getEntities());
    refresh();
    root.addEventListener("scroll", refresh);
    window.addEventListener("resize", refresh);
    onAdapterChange?.(adapter);
    return () => {
      root.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
      adapterRef.current = null;
      onAdapterChange?.(null);
    };
  }, [onAdapterChange, projection, resolveEditorEntityId]);

  const selectedRendererId = selectedSourcePointer === undefined
    ? undefined
    : rendererEntityId(selectedSourcePointer);

  useLayoutEffect(() => {
    const adapter = adapterRef.current;
    if (adapter === null) return;
    adapter.highlight(selectedRendererId === undefined
      ? { type: "clearHighlight" }
      : { type: "highlightEntities", entityIds: [selectedRendererId], reason: "selection" });
  }, [selectedRendererId, entities]);

  function selectDescriptor(entity: PreviewEntityDescriptor): void {
    const sourceFilePath = readStringMetadata(entity, "sourceFilePath");
    if (sourceFilePath === undefined) return;
    onSelect({
      id: readStringMetadata(entity, "editorEntityId") ?? entity.entityId,
      label: entity.label,
      sourcePointer: entity.authoringPointer,
      sourceFilePath
    });
  }

  return (
    <div ref={rootRef} className="telegram-structural-viewer" data-testid="telegram-structural-viewer">
      <div className="telegram-structural-warning" role="note">
        Структурный просмотр, не эмуляция клиента
      </div>
      {missingViewCallout !== null ? (
        <div className="telegram-missing-view-callout" role="status" data-testid="telegram-missing-view-callout">
          <strong>Для «{missingViewCallout.label}» отсутствует вид Telegram</strong>
          <span>Выбрана игровая сущность. Создать вид можно только там, где редактор знает допустимый UI-контейнер.</span>
        </div>
      ) : null}
      {projection === null ? (
        <div className="telegram-structural-empty">
          <strong>Для этой игры не найден вид Telegram</strong>
          <span>Добавьте UI-документ с каналом telegram, чтобы увидеть структуру сообщений.</span>
        </div>
      ) : (
        <section className="telegram-structural-feed" aria-label={`Структура Telegram: ${projection.title}`}>
          <header>{projection.title}</header>
          {projection.messages.length === 0 ? (
            <div className="telegram-structural-empty">В выбранном экране пока нет сообщений.</div>
          ) : projection.messages.map((message) => (
            <MessageCard
              key={`${message.sourcePointer}:${message.id}`}
              message={message}
              selectedSourcePointer={selectedSourcePointer}
              onSelect={onSelect}
              resolveEditorEntityId={resolveEditorEntityId}
            />
          ))}
        </section>
      )}
      <PreviewSelectionOverlay
        disabled={!inspectMode}
        entities={entities}
        selectedEntityId={selectedRendererId}
        promptContext={null}
        proposedIntent={null}
        unresolvedCount={entities.filter((entity) => readStringMetadata(entity, "editorEntityId") === undefined).length}
        onSelectEntity={(entity) => selectDescriptor(entity)}
        onSelectRegion={(regionEntities) => {
          const topEntity = regionEntities[0];
          if (topEntity !== undefined) selectDescriptor(topEntity);
        }}
        onClearContext={() => adapterRef.current?.highlight({ type: "clearHighlight" })}
        onPromptDraftChange={() => undefined}
        onPromptSubmit={() => undefined}
        onPromptClose={() => undefined}
      />
    </div>
  );
}

function MessageCard({
  message,
  selectedSourcePointer,
  onSelect,
  resolveEditorEntityId
}: {
  readonly message: TelegramStructuralMessage;
  readonly selectedSourcePointer?: string;
  readonly onSelect: (selection: TelegramStructuralSelection) => void;
  readonly resolveEditorEntityId?: (sourceFilePath: string, sourcePointer: string) => string | undefined;
}) {
  const isSelected = selectedSourcePointer === message.sourcePointer;
  return (
    <article className={`telegram-message telegram-message-${message.kind}${isSelected ? " is-selected" : ""}`}>
      <button
        className="telegram-message-body"
        type="button"
        aria-pressed={isSelected}
        {...previewTargetAttributes(message, resolveEditorEntityId)}
        onClick={() => onSelect(message)}
      >
        <small>{message.kind === "unknown" ? "Неизвестный компонент" : message.label}</small>
        <span>{message.text}</span>
        {message.kind === "unknown" ? <code>{message.sourcePointer}</code> : null}
      </button>
      {message.actions.length > 0 ? (
        <div className="telegram-inline-actions" aria-label="Встроенные действия">
          {message.actions.map((action) => (
            <ActionButton
              key={`${action.sourcePointer}:${action.id}`}
              action={action}
              selected={selectedSourcePointer === action.sourcePointer}
              onSelect={onSelect}
              resolveEditorEntityId={resolveEditorEntityId}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function ActionButton({
  action,
  selected,
  onSelect,
  resolveEditorEntityId
}: {
  readonly action: TelegramStructuralAction;
  readonly selected: boolean;
  readonly onSelect: (selection: TelegramStructuralSelection) => void;
  readonly resolveEditorEntityId?: (sourceFilePath: string, sourcePointer: string) => string | undefined;
}) {
  return (
    <button
      type="button"
      className={selected ? "is-selected" : ""}
      aria-pressed={selected}
      {...previewTargetAttributes(action, resolveEditorEntityId)}
      onClick={() => onSelect(action)}
    >
      {action.label}
    </button>
  );
}

function rendererEntityId(sourcePointer: string): string {
  return `telegram:${sourcePointer}`;
}

function previewTargetAttributes(
  target: TelegramStructuralSelection,
  resolveEditorEntityId: TelegramStructuralViewerProps["resolveEditorEntityId"]
): Readonly<Record<string, string>> {
  const ownerEntityId = resolveEditorEntityId?.(target.sourceFilePath, target.sourcePointer);
  return {
    "data-editor-entity-id": rendererEntityId(target.sourcePointer),
    "data-editor-owner-entity-id": ownerEntityId ?? "",
    "data-authoring-pointer": target.sourcePointer,
    "data-authoring-file": target.sourceFilePath,
    "data-editor-label": target.label,
    "data-editor-semantic-role": "telegram-ui-component",
    "data-editor-layer": "telegram-feed"
  };
}

function readStringMetadata(entity: PreviewEntityDescriptor, key: string): string | undefined {
  const value = entity.metadata?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}
