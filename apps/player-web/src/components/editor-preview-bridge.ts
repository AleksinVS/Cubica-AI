/**
 * Preview iframe bridge used only by editor preview sessions.
 *
 * The bridge scans explicit runtime pointer attributes rendered by player-web
 * and posts neutral entity descriptors to the parent editor. It does not know
 * authoring JSON and does not import editor packages.
 */
import { useEffect, type RefObject } from "react";
import type { SessionStateVersion } from "@cubica/contracts-session";
import { validateEditorDebugBridgeRequest, validateEditorPreviewContentRefreshRequest, validateEditorPreviewSceneRequest,
  validateEditorPreviewPrototypeRequest,
  validatePlayerPreviewEntitiesMessage,
  type EditorDebugBridgeRequest, type EditorDebugBridgeResponse, type EditorPreviewContentRefreshRequest,
  type EditorPreviewSceneRequest, type EditorPreviewPrototypeRequest, type PlayerPreviewEntitiesMessage } from "@cubica/contracts-session";

export interface EditorPreviewBridgeOptions {
  readonly enabled: boolean;
  readonly parentOrigin: string | undefined;
  readonly refreshSignal: unknown;
  readonly sessionSnapshot?: EditorPreviewSessionSnapshot;
  readonly compileRevision?: string;
  readonly screenKey?: string;
  readonly scene?: PlayerPreviewEntitiesMessage["context"]["scene"];
  readonly prototypePreview?: PlayerPreviewEntitiesMessage["context"]["prototypePreview"];
  readonly lastCompletedAction?: EditorPreviewCompletedAction;
  readonly onRestorePreviewSession?: (request: EditorPreviewRestoreRequest) => Promise<EditorPreviewSessionSnapshot>;
  readonly onDebugSession?: (request: EditorDebugBridgeRequest) => Promise<EditorDebugBridgeResponse>;
  readonly onRefreshPreviewContent?: (request: EditorPreviewContentRefreshRequest) => Promise<{ readonly requiresRestart?: boolean }>;
  readonly onShowPreviewScene?: (request: EditorPreviewSceneRequest) => Promise<void>;
  readonly onShowPreviewPrototype?: (request: EditorPreviewPrototypeRequest) => Promise<void>;
}

type PlayerPreviewEntityMessage = PlayerPreviewEntitiesMessage["entities"][number];

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

export function useEditorPreviewBridge(rootRef: RefObject<HTMLElement | null>, options: EditorPreviewBridgeOptions): void {
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
    let includeSessionSnapshot = false;

    function postPreviewEntities(withSession: boolean) {
      const root = rootRef.current;
      if (root === null) {
        return;
      }

      if (options.sessionSnapshot !== undefined) {
        const message = {
          source: "cubica-player-web",
          type: "previewEntities",
          version: 2,
          context: {
            sessionId: options.sessionSnapshot.sessionId,
            sessionVersion: options.sessionSnapshot.version,
            compileRevision: options.compileRevision ?? "unverified",
            ...(options.screenKey === undefined ? {} : { screenKey: options.screenKey }),
            ...(options.prototypePreview === undefined ? {} : { prototypePreview: options.prototypePreview }),
            scene: options.scene ?? {}
          },
          entities: collectPreviewEntities(root)
        };
        if (validatePlayerPreviewEntitiesMessage(message)) window.parent.postMessage(message, parentOrigin);
      }

      if (withSession && options.sessionSnapshot !== undefined) {
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
      if (frame !== undefined) return;
      let firedSynchronously = false;
      const scheduledFrame = window.requestAnimationFrame(() => {
        firedSynchronously = true;
        frame = undefined;
        const withSession = includeSessionSnapshot;
        includeSessionSnapshot = false;
        postPreviewEntities(withSession);
      });
      if (!firedSynchronously) frame = scheduledFrame;
    }

    function scheduleSnapshot() {
      includeSessionSnapshot = true;
      schedulePost();
    }

    function handleEditorMessage(event: MessageEvent) {
      // The request closes the iframe-load race without weakening the trust
      // boundary: only this frame's parent at the configured exact origin may
      // ask for the current preview snapshot to be published again.
      if (event.source !== window.parent || event.origin !== parentOrigin) {
        return;
      }
      if (isSnapshotRequest(event.data)) {
        scheduleSnapshot();
        return;
      }
      if (validateEditorDebugBridgeRequest(event.data)) {
        const command = event.data;
        if (options.onDebugSession !== undefined) {
          void options.onDebugSession(command).then((response) => {
            window.parent.postMessage(response, parentOrigin);
            scheduleSnapshot();
          }).catch(() => {
            window.parent.postMessage({
              source: "cubica-player-web", type: "debugSessionResult", protocolVersion: 1,
              requestId: command.requestId, sessionId: command.sessionId, ok: false,
              error: "Команда отладки не выполнена."
            }, parentOrigin);
          });
        }
        return;
      }
      if (validateEditorPreviewContentRefreshRequest(event.data)) {
        const request = event.data;
        if (request.sessionId !== options.sessionSnapshot?.sessionId || options.onRefreshPreviewContent === undefined) return;
        void options.onRefreshPreviewContent(request).then((result) => {
          window.parent.postMessage({ source: "cubica-player-web", type: "previewContentRefreshResult", protocolVersion: 1,
            requestId: request.requestId, sessionId: request.sessionId, revision: request.revision,
            ok: result.requiresRestart !== true, ...(result.requiresRestart ? { requiresRestart: true } : {}) }, parentOrigin);
          // The new revision is published by the render triggered by the
          // content swap, never by this stale effect closure.
        }).catch((error: unknown) => window.parent.postMessage({ source: "cubica-player-web", type: "previewContentRefreshResult", protocolVersion: 1,
          requestId: request.requestId, sessionId: request.sessionId, revision: request.revision, ok: false,
          error: error instanceof Error ? error.message.slice(0, 500) : "Preview refresh failed." }, parentOrigin));
        return;
      }
      if (validateEditorPreviewSceneRequest(event.data)) {
        const request = event.data;
        if (request.sessionId !== options.sessionSnapshot?.sessionId || options.onShowPreviewScene === undefined) return;
        void options.onShowPreviewScene(request).then(() => {
          window.parent.postMessage({ source: "cubica-player-web", type: "previewSceneResult", protocolVersion: 1,
            requestId: request.requestId, sessionId: request.sessionId, ok: true }, parentOrigin);
          // The rerender after scene selection publishes its new context.
        }).catch((error: unknown) => window.parent.postMessage({ source: "cubica-player-web", type: "previewSceneResult", protocolVersion: 1,
          requestId: request.requestId, sessionId: request.sessionId, ok: false,
          error: error instanceof Error ? error.message.slice(0, 500) : "Scene preview failed." }, parentOrigin));
        return;
      }
      if (validateEditorPreviewPrototypeRequest(event.data)) {
        const request = event.data;
        if (request.sessionId !== options.sessionSnapshot?.sessionId || options.onShowPreviewPrototype === undefined) return;
        void options.onShowPreviewPrototype(request).then(() => {
          window.parent.postMessage({ source: "cubica-player-web", type: "previewPrototypeResult", protocolVersion: 1,
            requestId: request.requestId, sessionId: request.sessionId, ok: true }, parentOrigin);
        }).catch((error: unknown) => window.parent.postMessage({ source: "cubica-player-web", type: "previewPrototypeResult", protocolVersion: 1,
          requestId: request.requestId, sessionId: request.sessionId, ok: false,
          error: error instanceof Error ? error.message.slice(0, 500) : "Prototype preview failed." }, parentOrigin));
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

    scheduleSnapshot();

    const resizeObserver =
      typeof ResizeObserver === "undefined" || rootRef.current === null
        ? undefined
        : new ResizeObserver(schedulePost);
    const observedResizeTargets = new Set<Element>();
    function syncResizeTargets() {
      if (resizeObserver === undefined) return;
      const root = rootRef.current;
      const targets = new Set<Element>(root === null ? [] : [root, ...root.children, ...root.querySelectorAll(previewSelector)]);
      for (const target of observedResizeTargets) {
        if (!targets.has(target)) { resizeObserver.unobserve(target); observedResizeTargets.delete(target); }
      }
      for (const target of targets) {
        if (!observedResizeTargets.has(target)) { resizeObserver.observe(target); observedResizeTargets.add(target); }
      }
    }
    syncResizeTargets();
    const mutationObserver = typeof MutationObserver === "undefined" || rootRef.current === null
      ? undefined
      : new MutationObserver(() => { syncResizeTargets(); schedulePost(); });
    mutationObserver?.observe(rootRef.current!, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ["class", "style", "hidden", "src", "width", "height",
        "data-preview-runtime-pointer", "data-preview-content-runtime-pointer", "data-preview-entity-id",
        "data-preview-label", "data-preview-semantic-role", "data-preview-layer", "data-preview-text-binding",
        "data-preview-z-index", "data-preview-selectable"]
    });
    let disposed = false;
    const fonts = document.fonts;
    void fonts?.ready.then(() => { if (!disposed) schedulePost(); });
    fonts?.addEventListener?.("loadingdone", schedulePost);
    window.addEventListener("resize", schedulePost);
    window.addEventListener("scroll", schedulePost, true);
    window.addEventListener("load", schedulePost, true);
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
      disposed = true;
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame);
      }
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      fonts?.removeEventListener?.("loadingdone", schedulePost);
      window.removeEventListener("resize", schedulePost);
      window.removeEventListener("scroll", schedulePost, true);
      window.removeEventListener("load", schedulePost, true);
      window.removeEventListener("message", handleEditorMessage);
    };
  }, [
    rootRef,
    options.enabled,
    options.parentOrigin,
    options.refreshSignal,
    options.sessionSnapshot,
    options.compileRevision,
    options.screenKey,
    options.scene?.screenId,
    options.scene?.stepIndex,
    options.scene?.activeInfoId,
    options.prototypePreview?.runtimePointer,
    options.prototypePreview?.requestId,
    options.lastCompletedAction,
    options.onRestorePreviewSession,
    options.onDebugSession,
    options.onRefreshPreviewContent,
    options.onShowPreviewScene,
    options.onShowPreviewPrototype
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
      entityId: baseEntityId,
      runtimePointer: element.dataset.previewRuntimePointer ?? "",
      contentRuntimePointer: readDatasetValue(element.dataset.previewContentRuntimePointer),
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
      selectable: element.dataset.previewSelectable !== "false",
      displayText: previewLeafText(element),
      textBinding: parsePreviewTextBinding(element.dataset.previewTextBinding)
    };
  });
}

function previewLeafText(element: HTMLElement): string | undefined {
  if (!["buttonComponent", "richTextComponent", "gameVariableComponent", "cardComponent"].includes(element.dataset.previewSemanticRole ?? "")) return undefined;
  const value = element.textContent?.replace(/\s+/gu, " ").trim() ?? "";
  return value === "" ? undefined : value.slice(0, 500);
}

function parsePreviewTextBinding(raw: string | undefined): PlayerPreviewEntityMessage["textBinding"] {
  if (raw === undefined || raw.length > 1500) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (!["html", "caption", "text", "value"].includes(String(record.prop)) ||
        typeof record.expression !== "string") return undefined;
    return record as PlayerPreviewEntityMessage["textBinding"];
  } catch { return undefined; }
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
