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
  readonly onRestorePreviewSession?: (request: EditorPreviewRestoreRequest) => Promise<EditorPreviewSessionSnapshot>;
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

export interface EditorPreviewRestoreRequest {
  readonly sessionId: string;
  readonly state: Record<string, unknown>;
  readonly version: {
    readonly stateVersion: number;
    readonly lastEventSequence: number;
  };
  readonly targetEventSequence?: number;
}

const previewSelector = "[data-preview-runtime-pointer]";

interface EditorPreviewSnapshotRequestMessage {
  readonly source: "cubica-editor-web";
  readonly type: "requestPreviewSnapshot";
  readonly version: 1;
}

interface EditorPreviewRestoreRequestMessage extends EditorPreviewRestoreRequest {
  readonly source: "cubica-editor-web";
  readonly type: "restorePreviewSession";
  readonly protocolVersion: 1;
  readonly requestId: string;
}

export function useEditorPreviewBridge(rootRef: RefObject<HTMLElement>, options: EditorPreviewBridgeOptions): void {
  useEffect(() => {
    if (!options.enabled || typeof window === "undefined") {
      return;
    }

    const configuredParentOrigin = confirmedParentOrigin(options.parentOrigin);
    if (configuredParentOrigin === undefined) {
      return;
    }
    const parentOrigin: string = configuredParentOrigin;

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
        parentOrigin
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
          parentOrigin
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

    function handleEditorMessage(event: MessageEvent) {
      // The request closes the iframe-load race without weakening the trust
      // boundary: only this frame's parent at the configured exact origin may
      // ask for the current preview snapshot to be published again.
      if (event.source !== window.parent || event.origin !== parentOrigin) {
        return;
      }
      if (isSnapshotRequest(event.data)) {
        schedulePost();
        return;
      }
      if (isRestoreRequest(event.data)) {
        void handleRestoreRequest(event.data);
      }
    }

    async function handleRestoreRequest(request: EditorPreviewRestoreRequestMessage) {
      const currentSessionId = options.sessionSnapshot?.sessionId;
      if (
        options.onRestorePreviewSession === undefined ||
        currentSessionId === undefined ||
        request.sessionId !== currentSessionId
      ) {
        postRestoreResult(request.requestId, false, "Preview restore request does not match the active session.");
        return;
      }

      try {
        const restored = await options.onRestorePreviewSession({
          sessionId: request.sessionId,
          state: request.state,
          version: request.version,
          targetEventSequence: request.targetEventSequence
        });
        // Return the durable runtime version so the editor can translate the
        // monotonic event ledger into its rewound, user-facing timeline.
        postRestoreResult(request.requestId, true, undefined, restored.version);
      } catch (error) {
        postRestoreResult(
          request.requestId,
          false,
          error instanceof Error ? error.message : "Preview restore failed."
        );
      }
    }

    function postRestoreResult(
      requestId: string,
      ok: boolean,
      error?: string,
      sessionVersion?: SessionStateVersion
    ) {
      window.parent.postMessage(
        {
          source: "cubica-player-web",
          type: "previewRestoreResult",
          version: 1,
          requestId,
          ok,
          ...(error === undefined ? {} : { error }),
          ...(sessionVersion === undefined ? {} : { sessionVersion })
        },
        parentOrigin
      );
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
    window.addEventListener("message", handleEditorMessage);
    // Tell the parent that the origin-checked request listener is now active.
    // The editor still repeats its request on iframe load, so either mounting
    // order converges without polling or wildcard targets.
    window.parent.postMessage(
      {
        source: "cubica-player-web",
        type: "previewBridgeReady",
        version: 1
      },
      parentOrigin
    );

    return () => {
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", schedulePost);
      window.removeEventListener("message", handleEditorMessage);
    };
  }, [
    rootRef,
    options.enabled,
    options.parentOrigin,
    options.refreshSignal,
    options.sessionSnapshot,
    options.lastCompletedAction,
    options.onRestorePreviewSession
  ]);
}

function isSnapshotRequest(value: unknown): value is EditorPreviewSnapshotRequestMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.source === "cubica-editor-web" && record.type === "requestPreviewSnapshot" && record.version === 1;
}

function isRestoreRequest(value: unknown): value is EditorPreviewRestoreRequestMessage {
  if (!isPlainRecord(value)) {
    return false;
  }
  if (
    value.source !== "cubica-editor-web" ||
    value.type !== "restorePreviewSession" ||
    value.protocolVersion !== 1 ||
    typeof value.requestId !== "string" ||
    value.requestId.length === 0 ||
    value.requestId.length > 128 ||
    typeof value.sessionId !== "string" ||
    !isPlainRecord(value.state) ||
    !isPlainRecord(value.version)
  ) {
    return false;
  }
  if (!isNonNegativeInteger(value.version.stateVersion) || !isNonNegativeInteger(value.version.lastEventSequence)) {
    return false;
  }
  return value.targetEventSequence === undefined || isNonNegativeInteger(value.targetEventSequence);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Returns a canonical web origin suitable for a `postMessage` target, if any. */
function confirmedParentOrigin(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    const origin = new URL(value).origin;
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
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
