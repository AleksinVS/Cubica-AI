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
import React, { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

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
}

const dragThresholdPx = 5;
const promptOffsetPx = 12;

export function PreviewSelectionOverlay({
  disabled = false,
  entities,
  selectedEntityId,
  promptContext,
  proposedIntent,
  unresolvedCount,
  onSelectEntity,
  onSelectRegion,
  onClearContext,
  onPromptDraftChange,
  onPromptSubmit,
  onPromptClose
}: PreviewSelectionOverlayProps) {
  const dragStartRef = useRef<PreviewPoint | null>(null);
  const dragFrameRef = useRef<number | undefined>(undefined);
  const [dragRect, setDragRect] = useState<PreviewRect | null>(null);
  const selectedEntity = entities.find((entity) => entity.entityId === selectedEntityId);

  useEffect(() => {
    return () => {
      if (dragFrameRef.current !== undefined) {
        window.cancelAnimationFrame(dragFrameRef.current);
      }
    };
  }, []);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) {
      return;
    }

    dragStartRef.current = pointFromEvent(event);
    setDragRect(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
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

    dragStartRef.current = null;
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
    if (topEntity === undefined) {
      onClearContext();
      return;
    }

    onSelectEntity(topEntity, point, result.entities);
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

  return (
    <div className="preview-overlay-root" aria-label="Preview selection layer">
      <div
        className={`preview-selection-hit-layer ${disabled ? "is-disabled" : ""}`}
        data-testid="preview-selection-overlay"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      {selectedEntity !== undefined ? <PreviewHighlightFrame entity={selectedEntity} /> : null}
      {dragRect !== null ? <PreviewRegionRect rect={dragRect} /> : null}
      {unresolvedCount > 0 ? (
        <span className="preview-overlay-warning">{unresolvedCount} unmapped preview objects</span>
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
      aria-label={`Selected preview object: ${entity.label}`}
    >
      <span>{entity.label}</span>
    </div>
  );
}

function PreviewRegionRect({ rect }: { readonly rect: PreviewRect }) {
  return <div className="preview-region-rect" style={rectStyle(rect)} aria-hidden="true" />;
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
        <strong>{context.kind === "region" ? "Region prompt" : "Object prompt"}</strong>
        <button type="button" onClick={onClose} aria-label="Close preview prompt">
          Close
        </button>
      </div>
      {targetCount > 1 ? (
        <div className="preview-object-picker">
          <button type="button">Layers</button>
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
        aria-label="AI prompt"
        rows={rows}
        value={context.draft}
        placeholder={targetCount > 1 ? `Describe a change for ${targetCount} objects` : "Describe a change"}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      <button type="button" className="preview-ai-submit" disabled={context.draft.trim() === ""} onClick={onSubmit}>
        Apply change
      </button>
      {proposedIntent !== null ? (
        <div className="preview-ai-intent">
          <span>Last editor intent</span>
          <strong>{proposedIntent.targetPointers.length} target pointers</strong>
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

function rectStyle(rect: PreviewRect): CSSProperties {
  return {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height
  };
}
