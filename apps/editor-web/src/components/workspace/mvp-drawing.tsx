import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PreviewPoint } from "@cubica/editor-engine";

import styles from "./mvp-drawing.module.css";
import { MvpFloatingPrompt, compactPromptWidth } from "./mvp-floating-prompt.tsx";
import {
  canAppendDrawingPoint,
  canStartDrawingStroke,
  getContainedImageFrame,
  isDrawingImageSizeAllowed,
  MVP_DRAWING_LIMITS,
  MVP_DRAWING_IMAGE_LIMITS,
  normalizeDrawingPoint,
  toFramePoint,
  type MvpDrawingFrame,
  type MvpDrawingPoint,
  type MvpDrawingSize
} from "./mvp-drawing-model.ts";

export interface MvpDrawingRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MvpDrawingStroke {
  readonly points: readonly MvpDrawingPoint[];
  readonly color?: string;
  readonly width?: number;
  /** Width normalized to the shortest side of the visible image frame. */
  readonly widthRatio?: number;
}

export interface MvpDrawingAnnotation {
  readonly text: string;
  /** Normalized position inside the visible drawing frame. */
  readonly x: number;
  readonly y: number;
}

export interface MvpDrawingBackground {
  readonly file?: File;
  readonly dataUrl: string;
  readonly width?: number;
  readonly height?: number;
  readonly name?: string;
  readonly type?: string;
}

export interface MvpDrawingSubmission {
  readonly prompt: string;
  readonly strokes: readonly MvpDrawingStroke[];
  readonly annotations: readonly MvpDrawingAnnotation[];
  readonly background?: MvpDrawingBackground;
  readonly region?: MvpDrawingRegion;
}

export interface MvpDrawingProps {
  readonly onSubmit: (submission: MvpDrawingSubmission) => Promise<void>;
  readonly disabled?: boolean;
  readonly pending?: boolean;
  readonly onCancel?: () => void;
  readonly onDone?: () => void;
  readonly region?: MvpDrawingRegion;
  readonly initialBackground?: MvpDrawingBackground;
  readonly children?: ReactNode;
  readonly className?: string;
  readonly pencilColor?: string;
  readonly pencilWidth?: number;
}

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ANNOTATION_FONT_SIZE = 20;
const ANNOTATION_LINE_HEIGHT = 26;
const DEFAULT_PENCIL_COLOR = "#ef4444";
const DEFAULT_PENCIL_WIDTH = 3;
const CLICK_MOVEMENT_THRESHOLD = 3;

type MarkHistoryEntry =
  | { readonly kind: "stroke"; readonly id: number }
  | { readonly kind: "annotation"; readonly id: number };
type StoredStroke = MvpDrawingStroke & { readonly id: number };
type StoredAnnotation = MvpDrawingAnnotation & { readonly id: number };
type ActiveStroke = {
  readonly pointerId: number;
  readonly points: MvpDrawingPoint[];
  readonly color: string;
  readonly width: number;
  readonly widthRatio?: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly maxDistance: number;
};

let nextMarkId = 1;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать изображение."));
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Не удалось прочитать изображение."));
    };
    reader.readAsDataURL(file);
  });
}

function decodeImage(dataUrl: string): Promise<MvpDrawingSize> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (width > 0 && height > 0) resolve({ width, height });
      else reject(new Error("Изображение не содержит декодируемых размеров."));
    };
    image.onerror = () => reject(new Error("Не удалось декодировать изображение."));
    image.src = dataUrl;
  });
}

function appendDistinctPoint(points: readonly MvpDrawingPoint[], point: MvpDrawingPoint): MvpDrawingPoint[] {
  const previous = points[points.length - 1];
  // Freehand input keeps subpixel detail. Only exact duplicate browser samples
  // are removed; the repeated-point selection tolerance does not apply here.
  return previous && previous.x === point.x && previous.y === point.y ? [...points] : [...points, point];
}

function frameForSurface(size: MvpDrawingSize, backgroundSize: MvpDrawingSize | undefined): MvpDrawingFrame {
  return getContainedImageFrame(size, backgroundSize);
}

function pointerRect(element: Element, fallback: MvpDrawingSize) {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width || fallback.width,
    height: rect.height || fallback.height
  };
}

function stageStyle(className: string | undefined): string {
  return className ? `${styles.stage} ${className}` : styles.stage;
}

export function MvpDrawing({
  onSubmit,
  disabled = false,
  pending = false,
  onCancel,
  onDone,
  region,
  initialBackground,
  children,
  className,
  pencilColor = DEFAULT_PENCIL_COLOR,
  pencilWidth = DEFAULT_PENCIL_WIDTH
}: MvpDrawingProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeStrokeRef = useRef<ActiveStroke | null>(null);
  const activeRenderFrameRef = useRef<number | null>(null);
  const promptDrawingPointRef = useRef<MvpDrawingPoint>({ x: 0.5, y: 0.25 });
  const mountedRef = useRef(true);
  const uploadSequenceRef = useRef(0);
  const [surfaceSize, setSurfaceSize] = useState<MvpDrawingSize>({ width: 1, height: 1 });
  const [background, setBackground] = useState<MvpDrawingBackground | undefined>(initialBackground);
  const [backgroundSize, setBackgroundSize] = useState<MvpDrawingSize | undefined>(
    initialBackground?.width && initialBackground.height
      ? { width: initialBackground.width, height: initialBackground.height }
      : undefined
  );
  const [strokes, setStrokes] = useState<StoredStroke[]>([]);
  const [activePoints, setActivePoints] = useState<MvpDrawingPoint[]>([]);
  const [activeStrokeStyle, setActiveStrokeStyle] = useState<{ color: string; width: number; widthRatio?: number } | undefined>();
  const [annotations, setAnnotations] = useState<StoredAnnotation[]>([]);
  const [history, setHistory] = useState<MarkHistoryEntry[]>([]);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptPoint, setPromptPoint] = useState<PreviewPoint>({ x: 8, y: 8 });
  const [promptInstance, setPromptInstance] = useState(0);
  const [localError, setLocalError] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isBusy = disabled || pending || uploading || submitting;
  const frame = useMemo(() => frameForSurface(surfaceSize, backgroundSize), [surfaceSize, backgroundSize]);
  const committedPoints = strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);

  const measureSurface = useCallback(() => {
    const element = stageRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setSurfaceSize({
      width: rect.width || element.clientWidth || 1,
      height: rect.height || element.clientHeight || 1
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      uploadSequenceRef.current += 1;
      activeStrokeRef.current = null;
      if (activeRenderFrameRef.current !== null) cancelAnimationFrame(activeRenderFrameRef.current);
    };
  }, []);

  useEffect(() => {
    measureSurface();
    const element = stageRef.current;
    if (typeof ResizeObserver !== "undefined" && element) {
      const observer = new ResizeObserver(measureSurface);
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measureSurface);
    return () => window.removeEventListener("resize", measureSurface);
  }, [measureSurface]);

  useEffect(() => {
    if (promptOpen) {
      const textarea = textareaRef.current;
      textarea?.focus();
      if (textarea) {
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        resizePrompt(textarea);
      }
    }
  }, [isBusy, promptInstance, promptOpen]);

  const normalizedPointFromEvent = useCallback(
    (event: React.PointerEvent<SVGSVGElement>): MvpDrawingPoint => {
      const rect = pointerRect(event.currentTarget, surfaceSize);
      const currentFrame = frameForSurface({ width: rect.width, height: rect.height }, backgroundSize);
      return normalizeDrawingPoint(event.clientX, event.clientY, rect, currentFrame);
    },
    [backgroundSize, surfaceSize]
  );

  const pointInSurface = useCallback(
    (point: MvpDrawingPoint): PreviewPoint => {
      const rect = pointerRect(stageRef.current ?? svgRef.current ?? document.body, surfaceSize);
      const currentFrame = frameForSurface({ width: rect.width, height: rect.height }, backgroundSize);
      const normalized = toFramePoint(point, currentFrame, { width: rect.width, height: rect.height });
      return { x: normalized.x * rect.width, y: normalized.y * rect.height };
    },
    [backgroundSize, surfaceSize]
  );

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (isBusy || event.button !== 0) return;
    if (strokes.length >= MVP_DRAWING_LIMITS.maxStrokes) {
      setLocalError(`Достигнут лимит штрихов (${MVP_DRAWING_LIMITS.maxStrokes}). Удалите старый штрих, чтобы продолжить.`);
      return;
    }
    if (!canStartDrawingStroke(strokes.length, committedPoints)) {
      setLocalError("Достигнут лимит точек рисунка (20 000).");
      return;
    }
    const point = normalizedPointFromEvent(event);
    const frameMinimum = Math.min(frame.width, frame.height);
    activeStrokeRef.current = {
      pointerId: event.pointerId,
      points: [point],
      color: pencilColor,
      width: pencilWidth,
      widthRatio: frameMinimum > 0 ? pencilWidth / frameMinimum : undefined,
      startClientX: event.clientX,
      startClientY: event.clientY,
      maxDistance: 0
    };
    if (activeRenderFrameRef.current !== null) cancelAnimationFrame(activeRenderFrameRef.current);
    activeRenderFrameRef.current = null;
    setActivePoints([point]);
    setActiveStrokeStyle({ color: pencilColor, width: pencilWidth, widthRatio: frameMinimum > 0 ? pencilWidth / frameMinimum : undefined });
    setPromptOpen(false);
    setLocalError(undefined);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some test DOMs and older browsers do not implement pointer capture.
    }
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const active = activeStrokeRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (!canAppendDrawingPoint(committedPoints, active.points.length)) {
      setLocalError("Достигнут лимит точек рисунка (20 000).");
      return;
    }
    const maxDistance = Math.max(active.maxDistance, Math.hypot(event.clientX - active.startClientX, event.clientY - active.startClientY));
    const nextPoints = appendDistinctPoint(active.points, normalizedPointFromEvent(event));
    activeStrokeRef.current = nextPoints.length === active.points.length ? { ...active, maxDistance } : { ...active, points: nextPoints, maxDistance };
    if (nextPoints.length === active.points.length) return;
    if (activeRenderFrameRef.current === null) {
      activeRenderFrameRef.current = requestAnimationFrame(() => {
        activeRenderFrameRef.current = null;
        setActivePoints(activeStrokeRef.current?.points ?? []);
      });
    }
  };

  const discardActiveStroke = (event?: React.PointerEvent<SVGSVGElement>) => {
    const active = activeStrokeRef.current;
    if (event && (!active || active.pointerId !== event.pointerId)) return;
    activeStrokeRef.current = null;
    if (activeRenderFrameRef.current !== null) cancelAnimationFrame(activeRenderFrameRef.current);
    activeRenderFrameRef.current = null;
    setActivePoints([]);
    setActiveStrokeStyle(undefined);
    if (event) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture is optional in the DOM used by component tests.
      }
    }
  };

  const finishStroke = (event: React.PointerEvent<SVGSVGElement>) => {
    const active = activeStrokeRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    activeStrokeRef.current = null;
    if (activeRenderFrameRef.current !== null) cancelAnimationFrame(activeRenderFrameRef.current);
    activeRenderFrameRef.current = null;
    setActivePoints([]);
    setActiveStrokeStyle(undefined);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture is optional in the DOM used by component tests.
    }
    const endpoint = normalizedPointFromEvent(event);
    const movement = Math.max(active.maxDistance, Math.hypot(event.clientX - active.startClientX, event.clientY - active.startClientY));
    const points = canAppendDrawingPoint(committedPoints, active.points.length)
      ? appendDistinctPoint(active.points, endpoint)
      : active.points;
    if (movement < CLICK_MOVEMENT_THRESHOLD) {
      openPromptAt(endpoint);
      return;
    }
    if (!points.length) return;
    const id = nextMarkId++;
    setStrokes((previous) => [...previous, { id, points, color: active.color, width: active.width, widthRatio: active.widthRatio }]);
    setHistory((previous) => [...previous, { kind: "stroke", id }]);
    openPromptAt(points[points.length - 1]);
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((previous) => previous.slice(0, -1));
    if (last.kind === "stroke") setStrokes((previous) => previous.filter((stroke) => stroke.id !== last.id));
    else setAnnotations((previous) => previous.filter((annotation) => annotation.id !== last.id));
    setPromptOpen(false);
  };

  const clearMarks = () => {
    setStrokes([]);
    setAnnotations([]);
    setHistory([]);
    setActivePoints([]);
    setActiveStrokeStyle(undefined);
    activeStrokeRef.current = null;
    if (activeRenderFrameRef.current !== null) cancelAnimationFrame(activeRenderFrameRef.current);
    activeRenderFrameRef.current = null;
    setPromptOpen(false);
    setLocalError(undefined);
  };

  const openPromptAt = (point: MvpDrawingPoint) => {
    if (isBusy) return;
    setLocalError(undefined);
    promptDrawingPointRef.current = point;
    setPromptPoint(pointInSurface(point));
    setPromptInstance((previous) => previous + 1);
    setPromptOpen(true);
  };

  const resizePrompt = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(124, Math.max(38, textarea.scrollHeight || 38))}px`;
  };

  const addAnnotation = () => {
    const text = draftPrompt.trim();
    if (!text || isBusy) return;
    const id = nextMarkId++;
    const drawingPoint = promptDrawingPointRef.current;
    setAnnotations((previous) => [...previous, { id, text, x: drawingPoint.x, y: drawingPoint.y }]);
    setHistory((previous) => [...previous, { kind: "annotation", id }]);
    setDraftPrompt("");
    setPromptOpen(false);
    setLocalError(undefined);
  };

  const submitPrompt = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = draftPrompt.trim();
    if (!prompt || isBusy) return;
    setSubmitting(true);
    setLocalError(undefined);
    try {
      await onSubmit({
        prompt,
        strokes: strokes.map(({ id: _id, ...stroke }) => stroke),
        annotations: annotations.map(({ id: _id, ...annotation }) => annotation),
        background,
        region
      });
      setDraftPrompt("");
      setPromptOpen(false);
      onDone?.();
    } catch (error) {
      setLocalError(errorText(error, "Не удалось отправить промт. Черновик сохранён."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      setLocalError("Поддерживаются только PNG, JPEG и WebP.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setLocalError("Изображение слишком большое. Максимальный размер — 8 МБ.");
      return;
    }
    setUploading(true);
    setLocalError(undefined);
    const sequence = ++uploadSequenceRef.current;
    const isCurrentUpload = () => mountedRef.current && uploadSequenceRef.current === sequence;
    try {
      const dataUrl = await readAsDataUrl(file);
      if (!isCurrentUpload()) return;
      const size = await decodeImage(dataUrl);
      if (!isCurrentUpload()) return;
      if (!isDrawingImageSizeAllowed(size)) {
        throw new Error(`Изображение слишком большое по разрешению. Максимум — ${MVP_DRAWING_IMAGE_LIMITS.maxEdge} px по стороне и 16 Мп.`);
      }
      setBackground({ file, dataUrl, width: size.width, height: size.height, name: file.name, type: file.type });
      setBackgroundSize(size);
    } catch (error) {
      if (isCurrentUpload()) setLocalError(errorText(error, "Не удалось загрузить изображение."));
    } finally {
      if (isCurrentUpload()) setUploading(false);
    }
  };

  const drawFramePoint = (point: MvpDrawingPoint) => toFramePoint(point, frame, surfaceSize);
  const svgWidth = Math.max(1, surfaceSize.width);
  const svgHeight = Math.max(1, surfaceSize.height);
  const drawPixelPoint = (point: MvpDrawingPoint) => {
    const framePoint = drawFramePoint(point);
    return { x: framePoint.x * svgWidth, y: framePoint.y * svgHeight };
  };
  const visibleStrokes = [
    ...strokes,
    ...(activePoints.length
      ? [{ id: -1, points: activePoints, color: activeStrokeStyle?.color ?? pencilColor, width: activeStrokeStyle?.width ?? pencilWidth, widthRatio: activeStrokeStyle?.widthRatio }]
      : [])
  ];

  return (
    <div ref={stageRef} className={stageStyle(className)} aria-label="Область рисования">
      <div className={styles.preview} aria-hidden="true">{children}</div>
      {background ? (
        <img
          className={styles.background}
          src={background.dataUrl}
          alt=""
          draggable={false}
          onLoad={(event) => {
            if (!backgroundSize) {
              const image = event.currentTarget;
              if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                setBackgroundSize({ width: image.naturalWidth, height: image.naturalHeight });
              }
            }
          }}
        />
      ) : null}
      <svg
        ref={svgRef}
        className={styles.canvas}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Холст рисования"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={discardActiveStroke}
        onLostPointerCapture={discardActiveStroke}
      >
        {visibleStrokes.map((stroke) => {
          const points = stroke.points.map(drawPixelPoint);
          const d = points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ");
          const width = stroke.widthRatio !== undefined
            ? stroke.widthRatio * Math.min(frame.width, frame.height)
            : stroke.width ?? pencilWidth;
          const color = stroke.color ?? pencilColor;
          return points.length > 1 ? (
            <path key={`stroke-${stroke.id}`} className={styles.stroke} d={d} pathLength={1} style={{ stroke: color, strokeWidth: width }} />
          ) : (
            <circle key={`stroke-${stroke.id}`} className={styles.strokeDot} cx={points[0]?.x ?? 0} cy={points[0]?.y ?? 0} r={width / 2} style={{ fill: color }} />
          );
        })}
        {annotations.map((annotation) => {
          const point = drawPixelPoint({ x: annotation.x, y: annotation.y });
          return (
            <text
              key={`annotation-${annotation.id}`}
              className={styles.annotation}
              x={point.x}
              y={point.y}
              fontSize={`${ANNOTATION_FONT_SIZE}px`}
            >
              {annotation.text.split("\n").map((line, index) => (
                <tspan key={`${annotation.id}-${index}`} x={point.x} dy={index === 0 ? 0 : ANNOTATION_LINE_HEIGHT}>{line}</tspan>
              ))}
            </text>
          );
        })}
      </svg>

      {promptOpen && !disabled ? (
        <MvpFloatingPrompt
          key={promptInstance}
          point={promptPoint}
          width={compactPromptWidth(draftPrompt, 76)}
          label="Промт рисования"
          className={styles.prompt}
        >
          <form className={styles.promptForm} onSubmit={submitPrompt}>
            <button type="button" className={styles.promptClose} disabled={isBusy} onClick={() => { setDraftPrompt(""); setPromptOpen(false); }} aria-label="Закрыть промт" title="Закрыть промт">×</button>
            <textarea
              ref={textareaRef}
              autoFocus
              aria-label="Инструкция для промта или текстовая пометка"
              value={draftPrompt}
              onChange={(event) => {
                setDraftPrompt(event.target.value);
                resizePrompt(event.currentTarget);
              }}
              rows={1}
              disabled={isBusy}
            />
            <div className={styles.promptActions}>
              <button type="submit" disabled={isBusy || !draftPrompt.trim()} aria-label="Отправить промт" title="Отправить промт"><span aria-hidden="true">↗</span></button>
              <button type="button" disabled={isBusy || !draftPrompt.trim()} onClick={addAnnotation} aria-label="Текст на рисунке" title="Текст на рисунке"><span aria-hidden="true">T</span></button>
            </div>
          </form>
        </MvpFloatingPrompt>
      ) : null}

      <div className={styles.toolbar} role="toolbar" aria-label="Инструменты рисования">
        <label className={styles.iconButton} aria-label="Загрузить изображение" title="Загрузить изображение">
          <span aria-hidden="true">＋</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleUpload} disabled={isBusy} />
        </label>
        <button type="button" className={styles.iconButton} onClick={undo} disabled={isBusy || history.length === 0} aria-label="Отменить последний штрих или текст" title="Отменить">↶</button>
        <button type="button" className={styles.iconButton} onClick={clearMarks} disabled={isBusy || history.length === 0} aria-label="Очистить рисунок" title="Очистить">×</button>
        {onCancel ? <button type="button" className={styles.iconButton} onClick={onCancel} disabled={isBusy} aria-label="Закрыть рисование" title="Закрыть">←</button> : null}
      </div>
      {localError ? <p className={styles.status} role="status">{localError}</p> : null}
    </div>
  );
}
