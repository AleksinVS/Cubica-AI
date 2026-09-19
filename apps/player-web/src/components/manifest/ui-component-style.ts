/**
 * The editor MVP writes only this small geometry subset. Keep the projection
 * deliberately narrow so arbitrary manifest keys never become inline CSS.
 */
export type UiComponentGeometryStyle = {
  width?: string;
  height?: string;
  transform?: string;
};
export type UiComponentGeometryCleanup = () => void;

const MAX_DIMENSION = 16_384;
const MAX_TRANSLATION = 100_000;
const DIMENSION_PATTERN = /^(?<value>\+?(?:\d+(?:\.\d+)?|\.\d+))(?<unit>px|%|em|rem|vw|vh)$/u;
const TRANSFORM_PATTERN = /^translate\(\s*(?<x>[+-]?(?:\d+(?:\.\d+)?|\.\d+))px\s*,\s*(?<y>[+-]?(?:\d+(?:\.\d+)?|\.\d+))px\s*\)\s+rotate\(\s*(?<rotation>[+-]?(?:\d+(?:\.\d+)?|\.\d+))deg\s*\)$/u;

/**
 * Projects authored component style into bounded, safe DOM geometry.
 * Unsupported values are omitted while supported fields remain independent.
 */
export function projectUiComponentGeometryStyle(style: unknown): UiComponentGeometryStyle | undefined {
  if (!style || typeof style !== "object" || Array.isArray(style)) {
    return undefined;
  }

  const source = style as Record<string, unknown>;
  const projected: UiComponentGeometryStyle = {};
  const width = projectDimension(source.width);
  const height = projectDimension(source.height);
  const transform = projectTransform(source.transform);

  if (width !== undefined) projected.width = width;
  if (height !== undefined) projected.height = height;
  if (transform !== undefined) projected.transform = transform;

  return Object.keys(projected).length > 0 ? projected : undefined;
}

/**
 * Apply projected geometry at the inline-important cascade level used by
 * legacy game styles. The returned cleanup restores every touched inline
 * declaration so removing authored geometry returns to the game's baseline.
 */
export function applyUiComponentGeometryStyle(
  element: HTMLElement | null,
  geometryStyle: UiComponentGeometryStyle | undefined
): UiComponentGeometryCleanup {
  if (!element || !geometryStyle) {
    return () => {};
  }

  const properties = [
    "width",
    "height",
    "transform",
    "min-width",
    "max-width",
    "min-height",
    "max-height"
  ] as const;
  const previous = new Map<string, { value: string; priority: string }>();
  for (const property of properties) {
    previous.set(property, {
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property)
    });
  }

  if (geometryStyle.width !== undefined) {
    setImportant(element, "width", geometryStyle.width);
    setImportant(element, "min-width", "0px");
    setImportant(element, "max-width", "none");
  }
  if (geometryStyle.height !== undefined) {
    setImportant(element, "height", geometryStyle.height);
    setImportant(element, "min-height", "0px");
    setImportant(element, "max-height", "none");
  }
  if (geometryStyle.transform !== undefined) {
    setImportant(element, "transform", geometryStyle.transform);
  }

  return () => {
    for (const property of properties) {
      const prior = previous.get(property)!;
      if (prior.value === "") {
        element.style.removeProperty(property);
      } else {
        element.style.setProperty(property, prior.value, prior.priority);
      }
    }
  };
}

function setImportant(element: HTMLElement, property: string, value: string): void {
  element.style.setProperty(property, value, "important");
}

function projectDimension(value: unknown): string | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 1 && value <= MAX_DIMENSION
      ? `${value}px`
      : undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized === "auto") {
    return normalized;
  }

  const match = DIMENSION_PATTERN.exec(normalized);
  if (!match?.groups) {
    return undefined;
  }

  const numericValue = Number(match.groups.value);
  return Number.isFinite(numericValue) && numericValue >= 1 && numericValue <= MAX_DIMENSION
    ? `${numericValue}${match.groups.unit}`
    : undefined;
}

function projectTransform(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const match = TRANSFORM_PATTERN.exec(value.trim());
  if (!match?.groups) {
    return undefined;
  }

  const x = Number(match.groups.x);
  const y = Number(match.groups.y);
  const rotation = Number(match.groups.rotation);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(rotation) ||
    Math.abs(x) > MAX_TRANSLATION ||
    Math.abs(y) > MAX_TRANSLATION
  ) {
    return undefined;
  }

  return `translate(${x}px, ${y}px) rotate(${rotation}deg)`;
}
