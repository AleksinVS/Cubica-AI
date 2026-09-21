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
import mvpStyles from "@/components/workspace/mvp-element-editor.module.css";
import { resizeMvpRect, type MvpGeometryGesture, type MvpResizeAnchor } from "./workspace/mvp-element-operations";
import { MvpFloatingPrompt, compactPromptWidth } from "./workspace/mvp-floating-prompt";

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
  readonly mvp?: boolean;
  readonly geometryUnsupportedReason?: string;
  readonly onGeometryCommit?: (entity: PreviewEntityDescriptor, gesture: MvpOverlayGesture) => Promise<boolean> | void;
  readonly onRegionRectChange?: (rect: PreviewRect) => void;
  readonly onStartDrawing?: (rect: PreviewRect) => void;
  readonly onSelectScope?: (scope: "game" | "page", point: PreviewPoint) => void;
  readonly disabled?: boolean;
  readonly entities: readonly PreviewEntityDescriptor[];
  /** Accepted preview identity; repeated-click layer cycling stays within one scene. */
  readonly selectionContextKey?: string;
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

export type MvpOverlayGesture = MvpGeometryGesture;

const dragThresholdPx = 5;
const promptOffsetPx = 12;

export function PreviewSelectionOverlay({
  mvp = false,
  geometryUnsupportedReason,
  onGeometryCommit,
  onRegionRectChange,
  onStartDrawing,
  onSelectScope,
  disabled = false,
  entities,
  selectionContextKey,
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
  const lastClickRef = useRef<{ readonly point: PreviewPoint; readonly ids: readonly string[];
    readonly index: number; readonly contextKey?: string } | null>(null);
  const layerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layerHeldRef = useRef(false);
  const [layerList, setLayerList] = useState<{ readonly point: PreviewPoint; readonly entities: readonly PreviewEntityDescriptor[] } | null>(null);
  const selectedEntity = entities.find((entity) => entity.entityId === selectedEntityId);
  const promptRegionRect = promptContext?.kind === "region" ? promptContext.rect : undefined;

  useEffect(() => {
    return () => {
      if (dragFrameRef.current !== undefined) {
        window.cancelAnimationFrame(dragFrameRef.current);
      }
      if (layerTimerRef.current !== null) clearTimeout(layerTimerRef.current);
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

    if (mvp && (selectedEntity !== undefined || promptRegionRect !== undefined)) {
      lastClickRef.current = null;
      setLayerList(null);
      onClearContext();
      return;
    }
    selectAt(point, startedAsPointSelection || pointSelectionEnabled || hasSingleSelectModifier(event));
  }

  function selectAt(point: PreviewPoint, isPointSelection = true) {
    const result = hitTestPreviewPoint(entities, point);
    const previous = lastClickRef.current;
    const sameClick = previous !== null && previous.contextKey === selectionContextKey &&
      Math.abs(previous.point.x - point.x) <= dragThresholdPx &&
      Math.abs(previous.point.y - point.y) <= dragThresholdPx &&
      previous.ids.join("\u0000") === result.entities.map((item) => item.entityId).join("\u0000");
    const selectedIndex = mvp && sameClick ? ((previous?.index ?? 0) + 1) % Math.max(1, result.entities.length) : 0;
    const topEntity = result.entities[selectedIndex];
    if (!isPointSelection && topEntity === undefined) {
      onClearContext();
      return;
    }

    if (topEntity === undefined) {
      lastClickRef.current = null;
      setLayerList(null);
      onClearContext();
      return;
    }

    if (mvp) {
      lastClickRef.current = { point, ids: result.entities.map((item) => item.entityId), index: selectedIndex,
        contextKey: selectionContextKey };
      showLayerList(point, result.entities);
    }
    onSelectEntity(topEntity, point, result.entities);
  }

  function showLayerList(point: PreviewPoint, layered: readonly PreviewEntityDescriptor[]) {
    if (layerTimerRef.current !== null) clearTimeout(layerTimerRef.current);
    setLayerList(layered.length > 0 || onSelectScope !== undefined ? { point, entities: layered } : null);
    layerTimerRef.current = setTimeout(() => {
      if (!layerHeldRef.current) setLayerList(null);
      layerTimerRef.current = null;
    }, 1000);
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
      {selectedEntity !== undefined ? mvp ? (
        <MvpGestureFrame
          entity={selectedEntity}
          unsupportedReason={geometryUnsupportedReason}
          onStartDrawing={onStartDrawing}
          onClickPoint={selectAt}
          onCommit={(gesture) => onGeometryCommit?.(selectedEntity, gesture)}
        />
      ) : <PreviewHighlightFrame entity={selectedEntity} /> : null}
      {dragRect !== null ? <PreviewRegionRect rect={dragRect} /> : null}
      {dragRect === null && promptRegionRect !== undefined ? mvp ? (
        <MvpGestureFrame
          regionRect={promptRegionRect}
          onStartDrawing={onStartDrawing}
          onCommit={(gesture) => {
            if (gesture.kind === "rotate") return;
            const next = gesture.kind === "move"
              ? { ...promptRegionRect, x: promptRegionRect.x + gesture.dx, y: promptRegionRect.y + gesture.dy }
              : resizeMvpRect(promptRegionRect, gesture.dx, gesture.dy, gesture.anchor);
            onRegionRectChange?.(next);
          }}
        />
      ) : <PreviewRegionRect rect={promptRegionRect} /> : null}
      {unresolvedCount > 0 ? (
        <span className="preview-overlay-warning">{unresolvedCount} unmapped preview objects</span>
      ) : null}
      {mvp && layerList !== null ? (
        <div
          className={mvpStyles.layerList}
          role="listbox"
          aria-label="Слои под указателем"
          style={{ left: Math.max(8, layerList.point.x - 184), top: Math.max(8, layerList.point.y - 10) }}
          onPointerEnter={() => { layerHeldRef.current = true; }}
          onPointerLeave={() => { layerHeldRef.current = false; setLayerList(null); }}
          onFocus={() => { layerHeldRef.current = true; }}
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { layerHeldRef.current = false; setLayerList(null); } }}
        >
          {layerList.entities.map((item) => (
            <button key={item.entityId} type="button" role="option" aria-selected={item.entityId === selectedEntityId}
              onClick={() => onSelectEntity(item, layerList.point, layerList.entities)}>{item.label}</button>
          ))}
          {onSelectScope !== undefined ? <>
            <button type="button" role="option" aria-selected={false} onClick={() => { onSelectScope("page", layerList.point); setLayerList(null); }}>Страница</button>
            <button type="button" role="option" aria-selected={false} onClick={() => { onSelectScope("game", layerList.point); setLayerList(null); }}>Игра</button>
          </> : null}
        </div>
      ) : null}
      {!mvp && contextMenu !== null ? (
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
      {promptContext !== null && (!mvp || promptContext.kind === "region") ? (
        <PreviewPromptBox
          mvp={mvp}
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

function MvpGestureFrame({
  entity,
  regionRect,
  unsupportedReason,
  onClickPoint,
  onCommit
}: {
  readonly entity?: PreviewEntityDescriptor;
  readonly regionRect?: PreviewRect;
  readonly unsupportedReason?: string;
  readonly onStartDrawing?: (rect: PreviewRect) => void;
  readonly onClickPoint?: (point: PreviewPoint) => void;
  readonly onCommit: (gesture: MvpOverlayGesture) => Promise<boolean> | void;
}) {
  const bounds = entity?.bounds ?? regionRect;
  const frameRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<{ kind: MvpOverlayGesture["kind"]; anchor?: MvpResizeAnchor; pointerId: number; x: number; y: number; startAngle: number } | null>(null);
  const commitPendingRef = useRef(false);
  const [preview, setPreview] = useState<MvpOverlayGesture | null>(null);
  if (bounds === undefined) return null;

  const shown = preview === null ? bounds : preview.kind === "move"
    ? { ...bounds, x: bounds.x + preview.dx, y: bounds.y + preview.dy }
    : preview.kind === "resize"
      ? resizeMvpRect(bounds, preview.dx, preview.dy, preview.anchor)
      : bounds;
  const disabled = entity !== undefined && unsupportedReason !== undefined;

  function start(kind: MvpOverlayGesture["kind"], event: PointerEvent<HTMLElement>, anchor?: MvpResizeAnchor) {
    if (bounds === undefined || event.button !== 0 || commitPendingRef.current || disabled && kind !== "move") return;
    event.preventDefault();
    event.stopPropagation();
    const host = frameRef.current?.parentElement;
    const hostRect = host?.getBoundingClientRect();
    const cx = (hostRect?.left ?? 0) + bounds.x + bounds.width / 2;
    const cy = (hostRect?.top ?? 0) + bounds.y + bounds.height / 2;
    gestureRef.current = { kind, anchor, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      startAngle: Math.atan2(event.clientY - cy, event.clientX - cx) };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function currentGesture(event: PointerEvent<HTMLElement>): MvpOverlayGesture | null {
    const start = gestureRef.current;
    if (start === null || start.pointerId !== event.pointerId || bounds === undefined) return null;
    if (start.kind === "resize") return { kind: "resize", dx: event.clientX - start.x, dy: event.clientY - start.y, anchor: start.anchor };
    if (start.kind === "move") return { kind: "move", dx: event.clientX - start.x, dy: event.clientY - start.y };
    const host = frameRef.current?.parentElement;
    const hostRect = host?.getBoundingClientRect();
    const cx = (hostRect?.left ?? 0) + bounds.x + bounds.width / 2;
    const cy = (hostRect?.top ?? 0) + bounds.y + bounds.height / 2;
    return { kind: "rotate", degrees: (Math.atan2(event.clientY - cy, event.clientX - cx) - start.startAngle) * 180 / Math.PI };
  }

  function finish(event: PointerEvent<HTMLElement>, commit: boolean) {
    const gesture = currentGesture(event);
    const started = gestureRef.current;
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const moved = gesture !== null && (gesture.kind === "rotate" ? Math.abs(gesture.degrees) >= 1 : Math.hypot(gesture.dx, gesture.dy) >= dragThresholdPx);
    if (commit && moved && !disabled && gesture !== null) {
      setPreview(gesture);
      try {
        const result = onCommit(gesture);
        if (result instanceof Promise) {
          commitPendingRef.current = true;
          const clearCommittedPreview = () => {
            commitPendingRef.current = false;
            setPreview(null);
          };
          void result.then(clearCommittedPreview, clearCommittedPreview);
        } else setPreview(null);
      } catch {
        setPreview(null);
      }
    } else {
      setPreview(null);
    }
    if (commit && !moved && started?.kind === "move") {
      const host = frameRef.current?.parentElement?.getBoundingClientRect();
      onClickPoint?.({ x: event.clientX - (host?.left ?? 0), y: event.clientY - (host?.top ?? 0) });
    }
  }

  const anchors: readonly MvpResizeAnchor[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const anchorStyle = (anchor: MvpResizeAnchor): CSSProperties => ({ left: anchor.includes("w") ? "0%" : anchor.includes("e") ? "100%" : "50%", top: anchor.includes("n") ? "0%" : anchor.includes("s") ? "100%" : "50%" });

  return (
    <div ref={frameRef} className={`${mvpStyles.gestureFrame} ${regionRect !== undefined ? mvpStyles.regionFrame : ""}`}
      style={{ ...rectStyle(shown), transform: preview?.kind === "rotate" ? `rotate(${preview.degrees}deg)` : undefined }}
      onPointerDown={(event) => start("move", event)}
      onPointerMove={(event) => { const gesture = currentGesture(event); if (gesture !== null && !disabled) setPreview(gesture); }}
      onPointerUp={(event) => finish(event, true)}
      onPointerCancel={(event) => finish(event, false)}
      aria-label={entity === undefined ? "Выделенная область" : `Выбран элемент: ${entity.label}`}>
      {anchors.map((anchor) => <button key={anchor} type="button" className={mvpStyles.resizeDot}
        style={{ ...anchorStyle(anchor), cursor: `${anchor}-resize` }} disabled={disabled} title={unsupportedReason}
        aria-label={`${entity === undefined ? "Изменить размер области" : "Изменить размер элемента"}: ${anchor}`}
        onPointerDown={(event) => start("resize", event, anchor)} />)}
      {regionRect === undefined ? (["nw", "ne", "se", "sw"] as const).map((anchor, index) => <button key={anchor} type="button" className={mvpStyles.rotationArea}
        style={{ ...anchorStyle(anchor), marginLeft: anchor.includes("w") ? -20 : 20, marginTop: anchor.includes("n") ? -20 : 20 }}
        disabled={disabled} title={unsupportedReason ?? "Повернуть элемент"} aria-label={`Повернуть элемент: ${anchor}`}
        onPointerDown={(event) => start("rotate", event)}>
        <svg viewBox="0 0 32 32" width="24" height="24" aria-hidden="true" style={{ transform: `rotate(${index * 90}deg)` }}>
          <path d="M8 24C8 15 15 8 24 8M5 19l3 5 4-4M19 5l5 3-4 4" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>) : null}
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
  mvp = false,
  context,
  proposedIntent,
  onDraftChange,
  onSubmit,
  onClose,
  onSelectEntity
}: {
  readonly mvp?: boolean;
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

  useEffect(() => {
    const field = textAreaRef.current;
    if (mvp && field !== null) { field.style.height = "0px"; field.style.height = `${Math.max(54, Math.min(380, field.scrollHeight))}px`; }
  }, [mvp, context.draft]);

  if (mvp) return <MvpFloatingPrompt point={context.point} avoid={context.rect} width={compactPromptWidth(context.draft)} label="Промт для области">
    <textarea ref={textAreaRef} aria-label={t.selectionOverlay.promptAria} rows={rows} value={context.draft}
      style={{ padding: "16px 20px 26px 2px" }} onChange={(event) => onDraftChange(event.target.value)}
      onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); onSubmit(); } }} />
    <button type="button" className={mvpStyles.promptClose} onClick={onClose} aria-label={t.selectionOverlay.closePromptAria} title="Закрыть">×</button>
    <button type="button" className={mvpStyles.promptSend} disabled={context.draft.trim() === ""} onClick={onSubmit} aria-label="Отправить промт" title="Отправить промт">↑</button>
  </MvpFloatingPrompt>;

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
