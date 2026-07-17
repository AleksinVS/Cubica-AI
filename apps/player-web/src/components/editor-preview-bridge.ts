/**
 * Preview iframe bridge used only by editor preview sessions.
 *
 * The bridge scans explicit runtime pointer attributes rendered by player-web
 * and posts neutral entity descriptors to the parent editor. It does not know
 * authoring JSON and does not import editor packages.
 */
import { useEffect, type RefObject } from "react";
import type { SessionStateVersion } from "@cubica/contracts-session";

export interface EditorPreviewBridgeOptions {
  readonly enabled: boolean;
  readonly parentOrigin: string | undefined;
  readonly refreshSignal: unknown;
  readonly sessionSnapshot?: EditorPreviewSessionSnapshot;
  readonly lastCompletedAction?: EditorPreviewCompletedAction;
}

interface PreviewRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface PlayerPreviewEntityMessage {
  readonly entityId: string;
  readonly runtimePointer: string;
  readonly label?: string;
  readonly semanticRole?: string;
  readonly layer?: string;
  readonly zIndex?: number;
  readonly renderOrder?: number;
  readonly bounds: PreviewRect;
  readonly visible?: boolean;
  readonly selectable?: boolean;
}

export interface EditorPreviewSessionSnapshot {
  readonly sessionId: string;
  readonly gameId?: string;
  readonly version: SessionStateVersion;
  readonly state: Record<string, unknown>;
}

export interface EditorPreviewCompletedAction {
  readonly actionId: string;
  readonly params?: Record<string, unknown>;
  readonly timestamp: string;
}

const previewSelector = "[data-preview-runtime-pointer]";

export function useEditorPreviewBridge(rootRef: RefObject<HTMLElement>, options: EditorPreviewBridgeOptions): void {
  useEffect(() => {
    if (!options.enabled || typeof window === "undefined") {
      return;
    }

    let frame: number | undefined;

    function postPreviewEntities() {
      const root = rootRef.current;
      if (root === null) {
        return;
      }

      window.parent.postMessage(
        {
          source: "cubica-player-web",
          type: "previewEntities",
          version: 1,
          entities: collectPreviewEntities(root)
        },
        options.parentOrigin ?? "*"
      );

      if (options.sessionSnapshot !== undefined) {
        window.parent.postMessage(
          {
            source: "cubica-player-web",
            type: "previewSessionSnapshot",
            version: 2,
            sessionId: options.sessionSnapshot.sessionId,
            gameId: options.sessionSnapshot.gameId,
            sessionVersion: options.sessionSnapshot.version,
            state: options.sessionSnapshot.state,
            action: options.lastCompletedAction
          },
          options.parentOrigin ?? "*"
        );
      }
    }

    function schedulePost() {
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame);
      }

      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        postPreviewEntities();
      });
    }

    schedulePost();

    const resizeObserver =
      typeof ResizeObserver === "undefined" || rootRef.current === null
        ? undefined
        : new ResizeObserver(schedulePost);
    if (rootRef.current !== null) {
      resizeObserver?.observe(rootRef.current);
    }
    window.addEventListener("resize", schedulePost);

    return () => {
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", schedulePost);
    };
  }, [
    rootRef,
    options.enabled,
    options.parentOrigin,
    options.refreshSignal,
    options.sessionSnapshot,
    options.lastCompletedAction
  ]);
}

function collectPreviewEntities(root: HTMLElement): readonly PlayerPreviewEntityMessage[] {
  return [...root.querySelectorAll<HTMLElement>(previewSelector)].map((element, index) => {
    const rect = element.getBoundingClientRect();
    const baseEntityId = element.dataset.previewEntityId ?? element.dataset.previewRuntimePointer ?? "entity";
    return {
      entityId: `${baseEntityId}:${index}`,
      runtimePointer: element.dataset.previewRuntimePointer ?? "",
      label: readDatasetValue(element.dataset.previewLabel),
      semanticRole: readDatasetValue(element.dataset.previewSemanticRole),
      layer: readDatasetValue(element.dataset.previewLayer),
      zIndex: readNumber(element.dataset.previewZIndex),
      renderOrder: index,
      bounds: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      },
      visible: rect.width > 0 && rect.height > 0 && isElementVisible(element),
      selectable: element.dataset.previewSelectable !== "false"
    };
  });
}

function readDatasetValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
}

function readNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isElementVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}
