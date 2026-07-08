"use client";

/**
 * Selection layer shown above the game preview iframe.
 *
 * The component works only with renderer-neutral descriptors from
 * `@cubica/editor-engine`. It does not read iframe DOM and therefore can be
 * reused for same-origin DOM previews, iframe message previews, and future
 * canvas renderers.
 */
import {
  hitTestPreviewPoint,
  hitTestPreviewRect,
  normalizePreviewRect,
  type PreviewEntityDescriptor,
  type PreviewPoint,
  type PreviewRect
} from "@cubica/editor-engine";
import React, { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent } from "react";

import { editorRu as t } from "@/lib/locale";

export interface PreviewAiIntent {
  readonly id: string;
  readonly kind: "entity" | "region";
  readonly prompt: string;
  readonly targetPointers: readonly string[];
  readonly createdAt: string;
}

export interface PreviewPromptContext {
  readonly kind: "entity" | "region";
  readonly point: PreviewPoint;
  readonly entities: readonly PreviewEntityDescriptor[];
  readonly rect?: PreviewRect;
  readonly draft: string;
}

export interface PreviewSelectionOverlayProps {
  readonly disabled?: boolean;
  readonly entities: readonly PreviewEntityDescriptor[];
  readonly selectedEntityId: string | undefined;
  readonly pointSelectionEnabled?: boolean;
  readonly promptContext: PreviewPromptContext | null;
  readonly proposedIntent: PreviewAiIntent | null;
  readonly unresolvedCount: number;
  readonly onSelectEntity: (
    entity: PreviewEntityDescriptor,
    point: PreviewPoint,
    layeredEntities: readonly PreviewEntityDescriptor[]
  ) => void;
  readonly onSelectRegion: (
    entities: readonly PreviewEntityDescriptor[],
    rect: PreviewRect,
    point: PreviewPoint
  ) => void;
  readonly onClearContext: () => void;
  readonly onPromptDraftChange: (draft: string) => void;
  readonly onPromptSubmit: () => void;
  readonly onPromptClose: () => void;
  readonly onTemporaryPlayChange?: (active: boolean) => void;
}

const dragThresholdPx = 5;
const promptOffsetPx = 12;

export function PreviewSelectionOverlay({
  disabled = false,
  entities,
  selectedEntityId,
  pointSelectionEnabled = false,
  promptContext,
  proposedIntent,
  unresolvedCount,
  onSelectEntity,
  onSelectRegion,
  onClearContext,
  onPromptDraftChange,
  onPromptSubmit,
  onPromptClose,
  onTemporaryPlayChange
}: PreviewSelectionOverlayProps) {
  const dragStartRef = useRef<PreviewPoint | null>(null);
  const dragStartedAsPointSelectionRef = useRef(false);
  const dragFrameRef = useRef<number | undefined>(undefined);
  const [dragRect, setDragRect] = useState<PreviewRect | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    readonly point: PreviewPoint;
    readonly entities: readonly PreviewEntityDescriptor[];
  } | null>(null);
  const selectedEntity = entities.find((entity) => entity.entityId === selectedEntityId);
  const promptRegionRect = promptContext?.kind === "region" ? promptContext.rect : undefined;

  useEffect(() => {
    return () => {
      if (dragFrameRef.current !== undefined) {
        window.cancelAnimationFrame(dragFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (disabled) {
      setContextMenu(null);
      setDragRect(null);
    }
  }, [disabled]);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) {
      return;
    }

    setContextMenu(null);
    if (event.altKey) {
      dragStartRef.current = null;
      dragStartedAsPointSelectionRef.current = false;
      setDragRect(null);
      onTemporaryPlayChange?.(true);
      return;
    }

    dragStartRef.current = pointFromEvent(event);
    dragStartedAsPointSelectionRef.current = pointSelectionEnabled || hasSingleSelectModifier(event);
    setDragRect(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (event.altKey) {
      dragStartRef.current = null;
      dragStartedAsPointSelectionRef.current = false;
      setDragRect(null);
      onTemporaryPlayChange?.(true);
      return;
    }

    onTemporaryPlayChange?.(false);

    const start = dragStartRef.current;
    if (disabled || start === null) {
      return;
    }

    const current = pointFromEvent(event);
    if (Math.abs(current.x - start.x) < dragThresholdPx && Math.abs(current.y - start.y) < dragThresholdPx) {
      return;
    }

    scheduleDragRect(start, current);
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;
    if (disabled || start === null) {
      return;
    }

    if (event.altKey) {
      dragStartRef.current = null;
      dragStartedAsPointSelectionRef.current = false;
      setDragRect(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      onTemporaryPlayChange?.(true);
      return;
    }

    dragStartRef.current = null;
    const startedAsPointSelection = dragStartedAsPointSelectionRef.current;
    dragStartedAsPointSelectionRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const point = pointFromEvent(event);
    const rect = normalizePreviewRect({
      x: start.x,
      y: start.y,
      width: point.x - start.x,
      height: point.y - start.y
    });

    setDragRect(null);

    if (rect.width >= dragThresholdPx || rect.height >= dragThresholdPx) {
      const result = hitTestPreviewRect(entities, rect);
      onSelectRegion(result.entities, rect, point);
      return;
    }

    const result = hitTestPreviewPoint(entities, point);
    const topEntity = result.entities[0];
    const isPointSelection = startedAsPointSelection || pointSelectionEnabled || hasSingleSelectModifier(event);
    if (!isPointSelection && topEntity === undefined) {
      onClearContext();
      return;
    }

    if (topEntity === undefined) {
      onClearContext();
      return;
    }

    onSelectEntity(topEntity, point, result.entities);
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (disabled) {
      return;
    }

    if (event.altKey) {
      onTemporaryPlayChange?.(true);
      return;
    }

    event.preventDefault();
    setDragRect(null);
    dragStartRef.current = null;

    const point = pointFromMouseEvent(event);
    const result = hitTestPreviewPoint(entities, point);
    if (result.entities.length === 0) {
      setContextMenu(null);
      onClearContext();
      return;
    }

    if (hasSingleSelectModifier(event)) {
      setContextMenu(null);
      onSelectEntity(result.entities[0] as PreviewEntityDescriptor, point, result.entities);
      return;
    }

    setContextMenu({ point, entities: result.entities });
  }

  function scheduleDragRect(start: PreviewPoint, current: PreviewPoint) {
    if (dragFrameRef.current !== undefined) {
      window.cancelAnimationFrame(dragFrameRef.current);
    }

    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = undefined;
      setDragRect(
        normalizePreviewRect({
          x: start.x,
          y: start.y,
          width: current.x - start.x,
          height: current.y - start.y
        })
      );
    });
  }

  if (disabled) {
    return (
      <div className="preview-overlay-root" aria-label={t.selectionOverlay.layerAria}>
        <div className="preview-selection-hit-layer is-disabled" data-testid="preview-selection-overlay" />
      </div>
    );
  }

  return (
    <div className={`preview-overlay-root ${contextMenu !== null ? "has-context-menu" : ""}`} aria-label={t.selectionOverlay.layerAria}>
      <div
        className="preview-selection-hit-layer"
        data-testid="preview-selection-overlay"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={handleContextMenu}
      />
      {selectedEntity !== undefined ? <PreviewHighlightFrame entity={selectedEntity} /> : null}
      {dragRect !== null ? <PreviewRegionRect rect={dragRect} /> : null}
      {dragRect === null && promptRegionRect !== undefined ? <PreviewRegionRect rect={promptRegionRect} /> : null}
      {unresolvedCount > 0 ? (
        <span className="preview-overlay-warning">{unresolvedCount} unmapped preview objects</span>
      ) : null}
      {contextMenu !== null ? (
        <PreviewObjectContextMenu
          point={contextMenu.point}
          entities={contextMenu.entities}
          onSelectEntity={(entity) => {
            setContextMenu(null);
            onSelectEntity(entity, contextMenu.point, contextMenu.entities);
          }}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
      {promptContext !== null ? (
        <PreviewPromptBox
          context={promptContext}
          proposedIntent={proposedIntent}
          onDraftChange={onPromptDraftChange}
          onSubmit={onPromptSubmit}
          onClose={onPromptClose}
          onSelectEntity={(entity) => onSelectEntity(entity, promptContext.point, promptContext.entities)}
        />
      ) : null}
    </div>
  );
}

function PreviewHighlightFrame({ entity }: { readonly entity: PreviewEntityDescriptor }) {
  return (
    <div
      className="preview-highlight-frame"
      style={rectStyle(entity.bounds)}
      aria-label={t.selectionOverlay.selectedObjectAria(entity.label)}
    >
      <span>{entity.label}</span>
    </div>
  );
}

function PreviewRegionRect({ rect }: { readonly rect: PreviewRect }) {
  return <div className="preview-region-rect" style={rectStyle(rect)} aria-hidden="true" />;
}

function PreviewObjectContextMenu({
  point,
  entities,
  onSelectEntity,
  onClose
}: {
  readonly point: PreviewPoint;
  readonly entities: readonly PreviewEntityDescriptor[];
  readonly onSelectEntity: (entity: PreviewEntityDescriptor) => void;
  readonly onClose: () => void;
}) {
  return (
    <div
      className="preview-object-context-menu"
      style={{
        left: Math.max(8, point.x + promptOffsetPx),
        top: Math.max(8, point.y + promptOffsetPx)
      }}
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="preview-object-context-menu-head">
        <strong>{t.selectionOverlay.objects}</strong>
        <button type="button" onClick={onClose} aria-label={t.selectionOverlay.closeMenuAria}>
          {t.selectionOverlay.close}
        </button>
      </div>
      {entities.map((entity) => (
        <button key={entity.entityId} type="button" role="menuitem" onClick={() => onSelectEntity(entity)}>
          <span>{entity.semanticRole}</span>
          <strong>{entity.label}</strong>
        </button>
      ))}
    </div>
  );
}

function PreviewPromptBox({
  context,
  proposedIntent,
  onDraftChange,
  onSubmit,
  onClose,
  onSelectEntity
}: {
  readonly context: PreviewPromptContext;
  readonly proposedIntent: PreviewAiIntent | null;
  readonly onDraftChange: (draft: string) => void;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
  readonly onSelectEntity: (entity: PreviewEntityDescriptor) => void;
}) {
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const targetCount = context.entities.length;
  const rows = Math.min(8, Math.max(1, context.draft.split("\n").length));

  useEffect(() => {
    textAreaRef.current?.focus();
  }, [context.kind, context.point.x, context.point.y]);

  return (
    <div
      className="preview-ai-prompt"
      style={{
        left: Math.max(8, context.point.x + promptOffsetPx),
        top: Math.max(8, context.point.y + promptOffsetPx)
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="preview-ai-prompt-head">
        <strong>{context.kind === "region" ? t.selectionOverlay.regionPrompt : t.selectionOverlay.objectPrompt}</strong>
        <button type="button" onClick={onClose} aria-label={t.selectionOverlay.closePromptAria}>
          {t.selectionOverlay.close}
        </button>
      </div>
      {targetCount > 1 ? (
        <div className="preview-object-picker">
          <button type="button">{t.selectionOverlay.layers}</button>
          <div className="preview-object-picker-menu" role="menu">
            {context.entities.map((entity) => (
              <button key={entity.entityId} type="button" role="menuitem" onClick={() => onSelectEntity(entity)}>
                <span>{entity.semanticRole}</span>
                <strong>{entity.label}</strong>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <textarea
        ref={textAreaRef}
        aria-label={t.selectionOverlay.promptAria}
        rows={rows}
        value={context.draft}
        placeholder={targetCount > 1 ? t.selectionOverlay.promptPlaceholderMany(targetCount) : t.selectionOverlay.promptPlaceholderOne}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      <button type="button" className="preview-ai-submit" disabled={context.draft.trim() === ""} onClick={onSubmit}>
        {t.selectionOverlay.applyChange}
      </button>
      {proposedIntent !== null ? (
        <div className="preview-ai-intent">
          <span>{t.selectionOverlay.lastIntent}</span>
          <strong>{t.selectionOverlay.targetPointers(proposedIntent.targetPointers.length)}</strong>
        </div>
      ) : null}
    </div>
  );
}

function pointFromEvent(event: PointerEvent<HTMLDivElement>): PreviewPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function pointFromMouseEvent(event: ReactMouseEvent<HTMLDivElement>): PreviewPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function hasSingleSelectModifier(event: Pick<PointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement>, "ctrlKey" | "metaKey" | "getModifierState">): boolean {
  return event.ctrlKey || event.metaKey || event.getModifierState("Control") || event.getModifierState("Meta");
}

function rectStyle(rect: PreviewRect): CSSProperties {
  return {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height
  };
}
