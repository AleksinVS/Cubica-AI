import React, { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import styles from "./mvp-drawing.module.css";
import {
  clampPopupPosition,
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
}

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type MarkHistoryEntry =
  | { readonly kind: "stroke"; readonly id: number }
  | { readonly kind: "annotation"; readonly id: number };
type StoredStroke = MvpDrawingStroke & { readonly id: number };
type StoredAnnotation = MvpDrawingAnnotation & { readonly id: number };
type ActiveStroke = { readonly pointerId: number; readonly points: MvpDrawingPoint[] };

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
  className
}: MvpDrawingProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popupRef = useRef<HTMLElement | null>(null);
  const activeStrokeRef = useRef<ActiveStroke | null>(null);
  const activeRenderFrameRef = useRef<number | null>(null);
  const popupAnchorRef = useRef<MvpDrawingPoint>({ x: 0.5, y: 0.25 });
  const popupDrawingPointRef = useRef<MvpDrawingPoint>({ x: 0.5, y: 0.25 });
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
  const [annotations, setAnnotations] = useState<StoredAnnotation[]>([]);
  const [history, setHistory] = useState<MarkHistoryEntry[]>([]);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [popupVisible, setPopupVisible] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ left: 8, top: 8 });
  const [popupSize, setPopupSize] = useState<MvpDrawingSize>({ width: 90, height: 44 });
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
    if (!popupVisible) return;
    const nextFrame = frameForSurface(surfaceSize, backgroundSize);
    const nextAnchor = toFramePoint(popupDrawingPointRef.current, nextFrame, surfaceSize);
    popupAnchorRef.current = nextAnchor;
    setPopupPosition(clampPopupPosition(nextAnchor, surfaceSize, popupSize));
  }, [popupVisible, surfaceSize, backgroundSize, popupSize]);

  useEffect(() => {
    if (!popupVisible) return;
    const element = popupRef.current;
    if (!element) return;
    const updateMeasuredSize = () => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      setPopupSize((previous) => previous.width === rect.width && previous.height === rect.height
        ? previous
        : { width: rect.width, height: rect.height });
    };
    updateMeasuredSize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateMeasuredSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [popupVisible, promptOpen]);

  useEffect(() => {
    if (promptOpen) {
      const textarea = textareaRef.current;
      textarea?.focus();
      if (textarea) {
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        resizePrompt(textarea);
      }
    }
  }, [promptOpen]);

  useEffect(() => {
    if (popupVisible && !promptOpen && !isBusy && popupRef.current instanceof HTMLButtonElement) {
      popupRef.current.focus();
    }
  }, [isBusy, popupVisible, promptOpen]);

  const normalizedPointFromEvent = useCallback(
    (event: React.PointerEvent<SVGSVGElement>): MvpDrawingPoint => {
      const rect = pointerRect(event.currentTarget, surfaceSize);
      const currentFrame = frameForSurface({ width: rect.width, height: rect.height }, backgroundSize);
      return normalizeDrawingPoint(event.clientX, event.clientY, rect, currentFrame);
    },
    [backgroundSize, surfaceSize]
  );

  const updatePopupAnchor = useCallback(
    (point: MvpDrawingPoint) => {
      const rect = pointerRect(stageRef.current ?? svgRef.current ?? document.body, surfaceSize);
      const currentFrame = frameForSurface({ width: rect.width, height: rect.height }, backgroundSize);
      popupDrawingPointRef.current = point;
      popupAnchorRef.current = toFramePoint(point, currentFrame, { width: rect.width, height: rect.height });
      setPopupPosition(clampPopupPosition(popupAnchorRef.current, { width: rect.width, height: rect.height }));
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
    activeStrokeRef.current = { pointerId: event.pointerId, points: [point] };
    if (activeRenderFrameRef.current !== null) cancelAnimationFrame(activeRenderFrameRef.current);
    activeRenderFrameRef.current = null;
    setActivePoints([point]);
    setPopupVisible(false);
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
    const nextPoints = appendDistinctPoint(active.points, normalizedPointFromEvent(event));
    if (nextPoints.length === active.points.length) return;
    activeStrokeRef.current = { ...active, points: nextPoints };
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
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture is optional in the DOM used by component tests.
    }
    const endpoint = normalizedPointFromEvent(event);
    const points = canAppendDrawingPoint(committedPoints, active.points.length)
      ? appendDistinctPoint(active.points, endpoint)
      : active.points;
    if (!points.length) return;
    const id = nextMarkId++;
    setStrokes((previous) => [...previous, { id, points }]);
    setHistory((previous) => [...previous, { kind: "stroke", id }]);
    updatePopupAnchor(points[points.length - 1]);
    setPopupSize({ width: 90, height: 44 });
    setPopupVisible(true);
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((previous) => previous.slice(0, -1));
    if (last.kind === "stroke") setStrokes((previous) => previous.filter((stroke) => stroke.id !== last.id));
    else setAnnotations((previous) => previous.filter((annotation) => annotation.id !== last.id));
    setPopupVisible(false);
    setPromptOpen(false);
  };

  const clearMarks = () => {
    setStrokes([]);
    setAnnotations([]);
    setHistory([]);
    setActivePoints([]);
    activeStrokeRef.current = null;
    if (activeRenderFrameRef.current !== null) cancelAnimationFrame(activeRenderFrameRef.current);
    activeRenderFrameRef.current = null;
    setPopupVisible(false);
    setPromptOpen(false);
    setLocalError(undefined);
  };

  const openPrompt = (seed = "") => {
    if (isBusy) return;
    setLocalError(undefined);
    if (seed) setDraftPrompt((previous) => previous + seed);
    setPopupSize({ width: 270, height: 200 });
    setPromptOpen(true);
    setPopupVisible(true);
  };

  const handlePromptButtonKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!isBusy && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      openPrompt(event.key);
    }
  };

  const resizePrompt = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(124, Math.max(38, textarea.scrollHeight || 38))}px`;
  };

  const addAnnotation = () => {
    const text = draftPrompt.trim();
    if (!text || isBusy) return;
    const id = nextMarkId++;
    const drawingPoint = popupDrawingPointRef.current;
    setAnnotations((previous) => [...previous, { id, text, x: drawingPoint.x, y: drawingPoint.y }]);
    setHistory((previous) => [...previous, { kind: "annotation", id }]);
    setDraftPrompt("");
    setPromptOpen(false);
    setPopupVisible(false);
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
      setPopupVisible(false);
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
  const visibleStrokes = [...strokes, ...(activePoints.length ? [{ id: -1, points: activePoints }] : [])];

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
        viewBox="0 0 1 1"
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
          const points = stroke.points.map(drawFramePoint);
          const d = points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ");
          return points.length > 1 ? (
            <path key={`stroke-${stroke.id}`} className={styles.stroke} d={d} pathLength={1} />
          ) : (
            <circle key={`stroke-${stroke.id}`} className={styles.strokeDot} cx={points[0]?.x ?? 0} cy={points[0]?.y ?? 0} r=".006" />
          );
        })}
        {annotations.map((annotation) => {
          const point = toFramePoint({ x: annotation.x, y: annotation.y }, frame, surfaceSize);
          return <text key={`annotation-${annotation.id}`} className={styles.annotation} x={point.x} y={point.y}>{annotation.text}</text>;
        })}
      </svg>

      {popupVisible && !disabled ? (
        promptOpen ? (
          <form
            ref={(element) => { popupRef.current = element; }}
            className={styles.prompt}
            style={{ left: popupPosition.left, top: popupPosition.top } as CSSProperties}
            onSubmit={submitPrompt}
          >
            <textarea
              ref={textareaRef}
              aria-label="Инструкция для промта или текстовая пометка"
              value={draftPrompt}
              onChange={(event) => {
                setDraftPrompt(event.target.value);
                resizePrompt(event.currentTarget);
              }}
              placeholder="Опишите изменение…"
              rows={1}
              disabled={isBusy}
            />
            <div className={styles.promptActions}>
              <button type="submit" disabled={isBusy || !draftPrompt.trim()} aria-label="Отправить промт">Промт</button>
              <button type="button" disabled={isBusy || !draftPrompt.trim()} onClick={addAnnotation} aria-label="Добавить текст на рисунок">Текст</button>
            </div>
          </form>
        ) : (
          <button
            ref={(element) => { popupRef.current = element; }}
            type="button"
            className={styles.promptLauncher}
            style={{ left: popupPosition.left, top: popupPosition.top } as CSSProperties}
            onClick={() => openPrompt()}
            onKeyDown={handlePromptButtonKeyDown}
            disabled={isBusy}
            aria-label="Открыть ввод промта"
            title="Открыть ввод промта"
          >
            <span className={styles.launcherLabel}>Промт</span><span className={styles.caret} aria-hidden="true" />
          </button>
        )
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
      {background ? <p className={styles.backgroundHint}>Фон добавлен отдельно от предпросмотра</p> : null}
    </div>
  );
}
