export interface MvpDrawingSize {
  readonly width: number;
  readonly height: number;
}

export interface MvpDrawingFrame extends MvpDrawingSize {
  readonly x: number;
  readonly y: number;
}

export interface MvpDrawingPoint {
  readonly x: number;
  readonly y: number;
}

export interface MvpDrawingRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface MvpDrawingPopupPosition {
  readonly left: number;
  readonly top: number;
}

export const MVP_DRAWING_LIMITS = {
  maxStrokes: 512,
  maxPoints: 20_000
} as const;

export const MVP_DRAWING_IMAGE_LIMITS = {
  maxEdge: 4096,
  maxPixels: 16_000_000
} as const;

export function isDrawingImageSizeAllowed(size: MvpDrawingSize): boolean {
  return size.width > 0 && size.height > 0
    && size.width <= MVP_DRAWING_IMAGE_LIMITS.maxEdge
    && size.height <= MVP_DRAWING_IMAGE_LIMITS.maxEdge
    && size.width * size.height <= MVP_DRAWING_IMAGE_LIMITS.maxPixels;
}

export function canStartDrawingStroke(strokeCount: number, pointCount: number): boolean {
  return strokeCount < MVP_DRAWING_LIMITS.maxStrokes && pointCount < MVP_DRAWING_LIMITS.maxPoints;
}

export function canAppendDrawingPoint(committedPoints: number, activePoints: number): boolean {
  return committedPoints + activePoints < MVP_DRAWING_LIMITS.maxPoints;
}

function finitePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/** Returns the visible image rectangle for CSS object-fit: contain. */
export function getContainedImageFrame(
  container: MvpDrawingSize,
  image: MvpDrawingSize | undefined
): MvpDrawingFrame {
  const containerWidth = finitePositive(container.width);
  const containerHeight = finitePositive(container.height);
  if (!image || !containerWidth || !containerHeight) {
    return { x: 0, y: 0, width: containerWidth, height: containerHeight };
  }

  const imageWidth = finitePositive(image.width);
  const imageHeight = finitePositive(image.height);
  if (!imageWidth || !imageHeight) {
    return { x: 0, y: 0, width: containerWidth, height: containerHeight };
  }

  const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height
  };
}

/** Converts a browser pointer coordinate to a point inside the visible frame. */
export function normalizeDrawingPoint(
  clientX: number,
  clientY: number,
  containerRect: MvpDrawingRect,
  frame: MvpDrawingFrame
): MvpDrawingPoint {
  const frameWidth = finitePositive(frame.width);
  const frameHeight = finitePositive(frame.height);
  if (!frameWidth || !frameHeight) return { x: 0, y: 0 };

  return {
    x: clampUnit((clientX - containerRect.left - frame.x) / frameWidth),
    y: clampUnit((clientY - containerRect.top - frame.y) / frameHeight)
  };
}

export function toFramePoint(point: MvpDrawingPoint, frame: MvpDrawingFrame, container: MvpDrawingSize): MvpDrawingPoint {
  const width = finitePositive(container.width);
  const height = finitePositive(container.height);
  return {
    x: width ? (frame.x + clampUnit(point.x) * frame.width) / width : 0,
    y: height ? (frame.y + clampUnit(point.y) * frame.height) / height : 0
  };
}

/** Clamps the floating prompt to the measured drawing surface. */
export function clampPopupPosition(
  anchor: MvpDrawingPoint,
  viewport: MvpDrawingSize,
  popup: MvpDrawingSize = { width: 270, height: 200 },
  gutter = 8
): MvpDrawingPopupPosition {
  const width = finitePositive(viewport.width);
  const height = finitePositive(viewport.height);
  const popupWidth = finitePositive(popup.width);
  const popupHeight = finitePositive(popup.height);
  const maxLeft = Math.max(gutter, width - popupWidth - gutter);
  const maxTop = Math.max(gutter, height - popupHeight - gutter);
  return {
    left: Math.min(maxLeft, Math.max(gutter, clampUnit(anchor.x) * width - popupWidth / 2)),
    top: Math.min(maxTop, Math.max(gutter, clampUnit(anchor.y) * height + 14))
  };
}
