import { useEffect, useRef, useState } from "react";
import type { EditorChangeSet, PreviewEntityDescriptor } from "@cubica/editor-engine";
import { validateEditorPreviewTemporaryLayerRequest, validateEditorPreviewTemporaryLayerResponse,
  type EditorPreviewTemporaryLayerRequest } from "@cubica/contracts-session";
import { createMvpVisualEditQueue } from "./mvp-visual-edit-queue";
import { projectMvpVisualChange } from "./mvp-visual-preview";

type Patch = EditorPreviewTemporaryLayerRequest["patches"][number];
interface Input {
  enabled: boolean;
  contextKey: string;
  documentRevision: string;
  documents: ReadonlyMap<string, string>;
  gameId: string;
  isPaused: () => boolean;
  entities: readonly PreviewEntityDescriptor[];
  previewUrl: string | null;
  frame: React.RefObject<HTMLIFrameElement | null>;
  commit: (change: EditorChangeSet) => Promise<{ ok: boolean; documents: ReadonlyMap<string, string>; previewReady?: boolean; reason?: string }>;
}

/** Temporary renderer values are separate from the authoritative authoring buffer. */
export function useMvpVisualEdits(input: Input) {
  const current = useRef(input); current.current = input;
  const queue = useRef(createMvpVisualEditQueue(input.contextKey, input.documents));
  const context = useRef(input.contextKey);
  const pumpingContexts = useRef(new Set<string>());
  const sequence = useRef(0);
  const visuals = useRef(new Map<string, { scene: string; base: ReadonlyMap<string, string> }>());
  const waitingForPreview = useRef(new Map<string, { contextKey: string; scene: string; changeSet: EditorChangeSet; base: ReadonlyMap<string, string> }>());
  const dismissed = useRef(new Set<string>());
  const ephemeral = useRef<{ scene: string; patches: Patch[] }>();
  const candidate = useRef<{ contextKey: string; scene: string; patches: Patch[]; changeSet: EditorChangeSet; base: ReadonlyMap<string, string> }>();
  const [revision, render] = useState(0);
  const [displayError, setDisplayError] = useState<string>();
  const requestIds = useRef(new Set<string>());
  const wake = () => render(value => value + 1);

  function playerContext() {
    return current.current.entities[0]?.metadata?.previewContext as unknown as
      { sessionId: string; compileRevision: string; scene: EditorPreviewTemporaryLayerRequest["scene"]; prototypePreview?: unknown } | undefined;
  }
  function sceneKey() {
    const player = playerContext();
    return JSON.stringify([current.current.contextKey, player?.scene, player?.prototypePreview]);
  }
  function snapshot() {
    const live = current.current;
    const player = playerContext();
    if (!live.enabled || !live.isPaused() || player === undefined || player.prototypePreview !== undefined || live.previewUrl === null) return;
    const scene = sceneKey();
    const patches: Patch[] = [...waitingForPreview.current.values()].flatMap(waiting =>
      waiting.contextKey === live.contextKey && waiting.scene === scene
        ? projectMvpVisualChange(waiting.changeSet, waiting.base, live.entities, live.gameId) ?? [] : []);
    patches.push(...queue.current.entries.flatMap(entry => {
      const view = visuals.current.get(entry.operationId);
      if (entry.contextKey !== live.contextKey || (entry.status !== "queued" && entry.status !== "inflight") || view?.scene !== scene) return [];
      // Re-map after an acknowledged compile or a new player session. Exact
      // source ownership must still be visible; never reuse a guessed target.
      return projectMvpVisualChange(entry.changeSet, view.base, live.entities, live.gameId) ?? [];
    }));
    if (candidate.current?.scene === scene) patches.push(...candidate.current.patches);
    if (ephemeral.current?.scene === scene) patches.push(...ephemeral.current.patches);
    const request = { source: "cubica-editor-web", type: "temporaryPreviewLayer", protocolVersion: 1,
      requestId: crypto.randomUUID(), sessionId: player.sessionId, compileRevision: player.compileRevision,
      scene: player.scene, sequence: ++sequence.current, patches: [...new Map(patches.map(patch =>
        [`${patch.runtimePointer}#${patch.ownerRuntimePointer}#${patch.property}`, patch])).values()] };
    if (!validateEditorPreviewTemporaryLayerRequest(request)) return;
    requestIds.current.add(request.requestId);
    // Only the newest reply matters for display diagnostics; bound gesture receipts.
    if (requestIds.current.size > 128) requestIds.current.delete(requestIds.current.values().next().value!);
    live.frame.current?.contentWindow?.postMessage(request, new URL(live.previewUrl).origin);
  }
  async function pump() {
    const contextKey = current.current.contextKey;
    if (context.current !== contextKey || pumpingContexts.current.has(contextKey) || !current.current.enabled) return;
    pumpingContexts.current.add(contextKey);
    try {
      for (;;) {
        if (current.current.contextKey !== contextKey || context.current !== contextKey) break;
        const request = queue.current.next();
        if (request === undefined || request.contextKey !== contextKey) break;
        const commit = current.current.commit;
        wake(); snapshot();
        try {
          const result = await commit(request.changeSet);
          if (result.ok) {
            const view = visuals.current.get(request.operationId);
            queue.current.acknowledge(request.operationId, result.documents);
            if (result.previewReady === false && view !== undefined) {
              waitingForPreview.current.set(request.operationId, { contextKey, scene: view.scene,
                changeSet: request.changeSet, base: view.base });
            } else if (result.previewReady === true) {
              for (const [id, waiting] of waitingForPreview.current) {
                if (waiting.contextKey === contextKey) waitingForPreview.current.delete(id);
              }
            }
          } else queue.current.reject(request.operationId, result.reason ?? "Проверка отклонила правку. Черновик сохранён.");
          visuals.current.delete(request.operationId);
        } catch (error) {
          if (current.current.contextKey === contextKey) {
            setDisplayError(error instanceof Error ? `Результат правки неизвестен: ${error.message}` : "Результат правки неизвестен. Черновик сохранён.");
          }
          break;
        }
        wake(); snapshot();
      }
    } finally { pumpingContexts.current.delete(contextKey); wake(); }
  }
  useEffect(() => {
    if (context.current !== input.contextKey) {
      context.current = input.contextKey;
      queue.current.setContext(input.contextKey, input.documents);
      ephemeral.current = undefined; candidate.current = undefined;
      setDisplayError(undefined); wake();
      void pump();
    } else if (!pumpingContexts.current.has(input.contextKey)) {
      queue.current.updateConfirmedDocuments(input.documents);
      wake();
    }
    snapshot();
  }, [input.contextKey, input.documentRevision]);
  const playerKey = JSON.stringify(input.entities[0]?.metadata?.previewContext ?? null);
  useEffect(() => { snapshot(); }, [input.enabled, playerKey, revision]);
  useEffect(() => {
    function receive(event: MessageEvent) {
      const live = current.current;
      if (live.previewUrl === null || event.origin !== new URL(live.previewUrl).origin || event.source !== live.frame.current?.contentWindow ||
          !validateEditorPreviewTemporaryLayerResponse(event.data) || !requestIds.current.has(event.data.requestId)) return;
      requestIds.current.delete(event.data.requestId);
      if (event.data.sequence !== sequence.current) return;
      setDisplayError(event.data.ok ? undefined : event.data.error ?? "Не удалось показать правку; ожидаем проверку.");
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  function project(change: EditorChangeSet) {
    return projectMvpVisualChange(change, queue.current.projectedDocuments, current.current.entities, current.current.gameId);
  }
  const projected = queue.current.projectedDocuments;
  const stableDocuments = useRef(projected);
  // Geometry reports change bounds, not source text. Preserve the snapshot identity
  // so consumers can reuse parsed documents and the semantic prompt projection.
  if (projected.size !== stableDocuments.current.size ||
      [...projected].some(([file, text]) => stableDocuments.current.get(file) !== text)) {
    stableDocuments.current = projected;
  }
  return {
    projectedDocuments: stableDocuments.current,
    pendingCount: queue.current.pending.filter(entry => entry.contextKey === input.contextKey).length +
      [...waitingForPreview.current.values()].filter(waiting => waiting.contextKey === input.contextKey).length,
    needsPreviewRefresh: [...waitingForPreview.current.values()].some(waiting => waiting.contextKey === input.contextKey),
    failedDrafts: queue.current.entries.filter(entry => entry.contextKey === input.contextKey && !dismissed.current.has(entry.operationId) && (entry.status === "rejected" || entry.status === "conflict")),
    displayError,
    canInteract: () => current.current.enabled && current.current.isPaused(),
    canProject: (change: EditorChangeSet) => current.current.enabled && current.current.isPaused() && project(change) !== undefined,
    enqueue(change: EditorChangeSet): boolean {
      if (!current.current.enabled || !current.current.isPaused()) return false;
      const base = queue.current.projectedDocuments;
      const patches = project(change);
      if (patches === undefined) return false;
      try { queue.current.enqueue(change); } catch (error) { setDisplayError(error instanceof Error ? error.message : "Не удалось подготовить правку."); return false; }
      visuals.current.set(change.id, { scene: sceneKey(), base });
      ephemeral.current = undefined;
      wake(); snapshot(); void pump();
      return true;
    },
    gesture(change: EditorChangeSet | undefined) {
      const patches = change === undefined ? undefined : project(change);
      ephemeral.current = patches === undefined ? undefined : { scene: sceneKey(), patches };
      snapshot();
    },
    candidate(change: EditorChangeSet | undefined) {
      candidate.current = change === undefined ? undefined : { contextKey: current.current.contextKey, scene: sceneKey(),
        patches: project(change) ?? [], changeSet: change, base: queue.current.projectedDocuments };
      snapshot();
    },
    settleCandidateAfterConfirm(operationId: string, previewReady: boolean) {
      const captured = candidate.current;
      if (captured?.changeSet.id !== operationId) return;
      if (!previewReady) waitingForPreview.current.set(operationId, { contextKey: captured.contextKey, scene: captured.scene,
        changeSet: captured.changeSet, base: captured.base });
      candidate.current = undefined;
      wake(); snapshot();
    },
    dismiss(operationId: string) {
      const entry = queue.current.entries.find(candidate => candidate.operationId === operationId);
      if (entry?.status === "queued" || entry?.status === "conflict") queue.current.dismiss(operationId);
      dismissed.current.add(operationId); wake(); snapshot();
    },
    markPreviewCurrent() {
      for (const [id, waiting] of waitingForPreview.current) {
        if (waiting.contextKey === current.current.contextKey) waitingForPreview.current.delete(id);
      }
      wake(); snapshot();
    },
    refresh: snapshot,
    retry: () => { setDisplayError(undefined); void pump(); },
    clearDisplayError: () => setDisplayError(undefined)
  };
}
