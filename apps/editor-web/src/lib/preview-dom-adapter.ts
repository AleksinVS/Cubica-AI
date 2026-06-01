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
  type PreviewEntityDescriptor,
  type PreviewHighlightCommand,
  type PreviewHitTestOptions,
  type PreviewHitTestResult,
  type PreviewPoint,
  type PreviewRect,
  type PreviewRendererAdapter
} from "@cubica/editor-engine";

export interface DomPreviewAdapterOptions {
  /** CSS selector used to find preview entities. */
  readonly selector?: string;
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
    }
  };
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
