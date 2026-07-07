/**
 * Thin DOM preview adapter for the preview-first editor.
 *
 * DOM (Document Object Model, browser tree of rendered elements) stays outside
 * `@cubica/editor-engine`. This adapter reads explicit `data-*` metadata from
 * rendered preview elements and converts it into renderer-neutral descriptors.
 */
import {
  hitTestPreviewPoint,
  hitTestPreviewRect,
  normalizePreviewRect,
  type PreviewEntityDescriptor,
  type PreviewHighlightCommand,
  type PreviewHitTestOptions,
  type PreviewHitTestResult,
  type PreviewPoint,
  type PreviewRect,
  type PreviewRegionSnapshot,
  type PreviewRendererAdapter
} from "@cubica/editor-engine";

export interface DomPreviewAdapterOptions {
  /** CSS selector used to find preview entities. */
  readonly selector?: string;
  /**
   * Optional raster source for the "region snapshot" capability
   * (ADR-057 §4.7; design-spec §2.7). Pass a `<canvas>` element or a selector
   * resolved within `root`; when omitted the adapter auto-detects the first
   * `<canvas>` descendant.
   *
   * IMPORTANT boundary: browsers cannot rasterize arbitrary HTML DOM without a
   * heavy dependency (html2canvas and the like are explicitly disallowed here),
   * and they refuse to read pixels across a CROSS-ORIGIN iframe at all — the
   * real editor preview is exactly such an iframe (player-web). A same-origin
   * `<canvas>` (2D/WebGL renderer) is the one browser-native raster source, so a
   * snapshot is only produced when one is available and untainted. No canvas, a
   * cross-origin/tainted canvas, or a non-browser host all yield `null`, which
   * degrades the region prompt to the entity list (correct per §8).
   */
  readonly snapshotCanvas?: HTMLCanvasElement | string;
}

const defaultEntitySelector = "[data-editor-entity-id][data-authoring-pointer]";

export function createDomPreviewAdapter(root: ParentNode, options: DomPreviewAdapterOptions = {}): PreviewRendererAdapter {
  const selector = options.selector ?? defaultEntitySelector;

  return {
    getEntities() {
      return collectDomPreviewEntities(root, selector);
    },
    hitTestPoint(point: PreviewPoint, hitOptions?: PreviewHitTestOptions): PreviewHitTestResult {
      return hitTestPreviewPoint(collectDomPreviewEntities(root, selector), point, hitOptions);
    },
    hitTestRect(rect: PreviewRect, hitOptions?: PreviewHitTestOptions): PreviewHitTestResult {
      return hitTestPreviewRect(collectDomPreviewEntities(root, selector), rect, hitOptions);
    },
    highlight(command: PreviewHighlightCommand) {
      applyDomHighlight(root, selector, command);
    },
    async captureRegionSnapshot(rect: PreviewRect): Promise<PreviewRegionSnapshot | null> {
      return captureDomRegionSnapshot(root, rect, options.snapshotCanvas);
    }
  };
}

/**
 * Best-effort browser-native region snapshot (ADR-057 §4.7; design-spec §2.7).
 *
 * Returns `null` (honest degradation, never throws) whenever a real image cannot
 * be produced: no `<canvas>` raster source, a zero-sized region, a tainted or
 * cross-origin canvas (`toDataURL` raises `SecurityError`), or a non-browser
 * host. Only a same-origin `<canvas>` yields a snapshot — see the boundary note
 * on {@link DomPreviewAdapterOptions.snapshotCanvas}.
 */
export function captureDomRegionSnapshot(
  root: ParentNode,
  rect: PreviewRect,
  snapshotCanvas?: HTMLCanvasElement | string
): PreviewRegionSnapshot | null {
  if (typeof document === "undefined") {
    return null;
  }

  const source = resolveSnapshotCanvas(root, snapshotCanvas);
  if (source === null) {
    return null;
  }

  const normalized = normalizePreviewRect(rect);
  const width = Math.round(normalized.width);
  const height = Math.round(normalized.height);
  if (width <= 0 || height <= 0) {
    return null;
  }

  // Map the viewport-space region (entity bounds use getBoundingClientRect) into
  // the canvas intrinsic pixel space, accounting for CSS scaling of the canvas.
  const canvasRect = source.getBoundingClientRect();
  if (canvasRect.width <= 0 || canvasRect.height <= 0) {
    return null;
  }
  const scaleX = source.width / canvasRect.width;
  const scaleY = source.height / canvasRect.height;
  const sourceX = (normalized.x - canvasRect.left) * scaleX;
  const sourceY = (normalized.y - canvasRect.top) * scaleY;
  const sourceWidth = normalized.width * scaleX;
  const sourceHeight = normalized.height * scaleY;

  const target = document.createElement("canvas");
  target.width = width;
  target.height = height;
  const context = target.getContext("2d");
  if (context === null) {
    return null;
  }

  try {
    context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
    // toDataURL throws SecurityError when the canvas was tainted by cross-origin
    // pixels; we treat that as a clean "no snapshot" rather than an error.
    const dataUrl = target.toDataURL("image/png");
    return {
      mediaType: "image/png",
      width,
      height,
      rect: normalized,
      dataUrl,
      capturedAt: new Date().toISOString()
    };
  } catch {
    return null;
  }
}

function resolveSnapshotCanvas(root: ParentNode, snapshotCanvas?: HTMLCanvasElement | string): HTMLCanvasElement | null {
  if (typeof snapshotCanvas === "object" && snapshotCanvas !== null) {
    return snapshotCanvas;
  }

  const candidate = typeof snapshotCanvas === "string" ? root.querySelector(snapshotCanvas) : root.querySelector("canvas");
  return candidate instanceof HTMLCanvasElement ? candidate : null;
}

export function collectDomPreviewEntities(root: ParentNode, selector = defaultEntitySelector): readonly PreviewEntityDescriptor[] {
  return [...root.querySelectorAll(selector)].map((element, index) => toPreviewEntityDescriptor(element, index));
}

function toPreviewEntityDescriptor(element: Element, renderOrder: number): PreviewEntityDescriptor {
  const entityId = readRequiredAttribute(element, "data-editor-entity-id");
  const authoringPointer = readRequiredAttribute(element, "data-authoring-pointer");
  const rect = element.getBoundingClientRect();
  const visible = readBooleanAttribute(element, "data-editor-visible", !element.hasAttribute("hidden") && isStyleVisible(element));
  const selectable = readBooleanAttribute(element, "data-editor-selectable", true);
  const label =
    readOptionalAttribute(element, "data-editor-label") ??
    readOptionalAttribute(element, "aria-label") ??
    compactDomText(element.textContent) ??
    entityId;

  return {
    entityId,
    authoringPointer,
    runtimePointer: readOptionalAttribute(element, "data-runtime-pointer"),
    label,
    semanticRole: readOptionalAttribute(element, "data-editor-semantic-role") ?? readOptionalAttribute(element, "data-editor-role") ?? "ui-component",
    layer: readOptionalAttribute(element, "data-editor-layer"),
    zIndex: readNumberAttribute(element, "data-editor-z-index") ?? readComputedZIndex(element),
    renderOrder,
    bounds: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    },
    visible,
    selectable
  };
}

function applyDomHighlight(root: ParentNode, selector: string, command: PreviewHighlightCommand): void {
  const elements = [...root.querySelectorAll(selector)];
  for (const element of elements) {
    element.removeAttribute("data-editor-highlighted");
    element.removeAttribute("data-editor-highlight-reason");
  }

  if (command.type === "clearHighlight") {
    return;
  }

  const highlightedIds = new Set(command.entityIds);
  for (const element of elements) {
    const entityId = readOptionalAttribute(element, "data-editor-entity-id");
    if (entityId === undefined || !highlightedIds.has(entityId)) {
      continue;
    }

    element.setAttribute("data-editor-highlighted", "true");
    if (command.reason !== undefined) {
      element.setAttribute("data-editor-highlight-reason", command.reason);
    }
  }
}

function readRequiredAttribute(element: Element, name: string): string {
  const value = readOptionalAttribute(element, name);
  if (value === undefined) {
    throw new Error(`Preview entity element is missing ${name}.`);
  }

  return value;
}

function readOptionalAttribute(element: Element, name: string): string | undefined {
  const value = element.getAttribute(name)?.trim();
  return value === "" ? undefined : value;
}

function readBooleanAttribute(element: Element, name: string, fallback: boolean): boolean {
  const raw = readOptionalAttribute(element, name);
  if (raw === undefined) {
    return fallback;
  }

  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

function readNumberAttribute(element: Element, name: string): number | undefined {
  const raw = readOptionalAttribute(element, name);
  if (raw === undefined) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readComputedZIndex(element: Element): number | undefined {
  const view = element.ownerDocument.defaultView;
  const zIndex = view?.getComputedStyle(element).zIndex;
  if (zIndex === undefined || zIndex === "auto") {
    return undefined;
  }

  const parsed = Number(zIndex);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isStyleVisible(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);
  return style?.display !== "none" && style?.visibility !== "hidden";
}

function compactDomText(text: string | null): string | undefined {
  const compacted = text?.replace(/\s+/gu, " ").trim() ?? "";
  if (compacted === "") {
    return undefined;
  }

  return compacted.length <= 80 ? compacted : `${compacted.slice(0, 77)}...`;
}
