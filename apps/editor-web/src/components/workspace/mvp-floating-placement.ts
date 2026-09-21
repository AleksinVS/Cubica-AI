export interface FloatingRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FloatingBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface LayerListPlacement {
  readonly x: number;
  readonly y: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
}

const gap = 8;
const usableWidth = 112;
const usableHeight = 36;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, Math.max(minimum, maximum)));
}

function intersectionArea(a: FloatingRect, b: FloatingRect): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

/** Place the scrollable layer list in a free strip around the measured prompt. All inputs are viewport coordinates. */
export function placeLayerList(
  point: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
  bounds: FloatingBounds,
  prompt?: FloatingRect
): LayerListPlacement {
  const left = bounds.left + gap;
  const top = bounds.top + gap;
  const right = bounds.right - gap;
  const bottom = bounds.bottom - gap;
  const baseWidth = Math.min(size.width, Math.max(0, right - left));
  const baseHeight = Math.min(size.height, Math.max(0, bottom - top));
  const at = (x: number, y: number, width = baseWidth, height = baseHeight): LayerListPlacement => ({
    x: clamp(x, left, right - width),
    y: clamp(y, top, bottom - height),
    maxWidth: width,
    maxHeight: height
  });
  if (prompt === undefined) return at(point.x - gap - baseWidth, point.y - 10);

  const leftWidth = Math.min(baseWidth, prompt.x - gap - left);
  const rightStart = prompt.x + prompt.width + gap;
  const rightWidth = Math.min(baseWidth, right - rightStart);
  const topHeight = Math.min(baseHeight, prompt.y - gap - top);
  const bottomStart = prompt.y + prompt.height + gap;
  const bottomHeight = Math.min(baseHeight, bottom - bottomStart);
  const horizontalY = clamp(point.y - 10, top, bottom - baseHeight);
  const candidates = {
    left: leftWidth >= usableWidth ? at(clamp(point.x - gap - leftWidth, left, prompt.x - gap - leftWidth), horizontalY, leftWidth) : undefined,
    right: rightWidth >= usableWidth ? at(clamp(point.x + gap, rightStart, right - rightWidth), horizontalY, rightWidth) : undefined,
    top: topHeight >= usableHeight ? at(point.x - baseWidth / 2,
      clamp(point.y - gap - topHeight, top, prompt.y - gap - topHeight), baseWidth, topHeight) : undefined,
    bottom: bottomHeight >= usableHeight ? at(point.x - baseWidth / 2,
      clamp(point.y + gap, bottomStart, bottom - bottomHeight), baseWidth, bottomHeight) : undefined
  };
  const promptRight = prompt.x + prompt.width / 2 >= point.x;
  const promptBelow = prompt.y + prompt.height / 2 >= point.y;
  const order = [promptRight ? "left" : "right", promptBelow ? "top" : "bottom",
    promptBelow ? "bottom" : "top", promptRight ? "right" : "left"] as const;
  const oppositeCursor = (side: keyof typeof candidates, candidate: LayerListPlacement) => {
    if (side === "left") return candidate.x + candidate.maxWidth <= point.x;
    if (side === "right") return candidate.x >= point.x;
    if (side === "top") return candidate.y + candidate.maxHeight <= point.y;
    return candidate.y >= point.y;
  };
  for (const side of order) {
    const candidate = candidates[side];
    if (candidate !== undefined && oppositeCursor(side, candidate)) return candidate;
  }
  for (const side of order) {
    const candidate = candidates[side];
    if (candidate !== undefined) return candidate;
  }

  // Only a viewport with no free strip wide enough for a list and tall enough for one row
  // reaches this fallback. Keep the list visible and minimize unavoidable overlap.
  const corners = [at(left, top), at(right - baseWidth, top), at(left, bottom - baseHeight), at(right - baseWidth, bottom - baseHeight)];
  return corners.reduce((best, candidate) => {
    const overlap = intersectionArea({ x: candidate.x, y: candidate.y, width: candidate.maxWidth, height: candidate.maxHeight }, prompt);
    const bestOverlap = intersectionArea({ x: best.x, y: best.y, width: best.maxWidth, height: best.maxHeight }, prompt);
    if (overlap !== bestOverlap) return overlap < bestOverlap ? candidate : best;
    const distance = Math.abs(candidate.x - point.x) + Math.abs(candidate.y - point.y);
    const bestDistance = Math.abs(best.x - point.x) + Math.abs(best.y - point.y);
    return distance < bestDistance ? candidate : best;
  });
}
