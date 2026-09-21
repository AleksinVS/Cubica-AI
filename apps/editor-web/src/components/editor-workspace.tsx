"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorAgentRuntimeHooks, EditorCopilotChatPanel } from "@/components/editor-agent-ui";
import { MvpFloatingMenu, type MvpMenuMode } from "@/components/workspace/mvp-floating-menu";
import { PreviewStage } from "@/components/workspace/preview-stage";
import { SessionRecoveryBanner } from "@/components/workspace/session-recovery-banner";
import { useEditorWorkspace } from "@/components/workspace/use-editor-workspace";
import { savedStateUnavailableReason, useMvpDebugSession } from "@/components/workspace/use-mvp-debug-session";
import { debugCatalogKey } from "@/lib/editor-debug-catalog";
import { MvpRulesPanel } from "@/components/workspace/mvp-rules-panel";
import { MvpDrawing, type MvpDrawingSubmission, type MvpDrawingRegion } from "@/components/workspace/mvp-drawing";
import { drawingAgentMessage, type EditorMessageSender } from "@/components/workspace/mvp-agent-message";
import { isPlayerPreviewBridgeReadyMessage, isPlayerPreviewSessionSnapshotMessage } from "@/lib/preview-message-adapter";
import { safeUrlOrigin } from "@/components/workspace/workspace-helpers";
import styles from "@/components/workspace/mvp-workspace.module.css";
import { buildMvpScenarioEntries } from "@/components/workspace/mvp-scenario-entries";
import { mvpSharedChangeImpact, type MvpCreateKind } from "@/components/workspace/mvp-authoring-actions";

/** The preview stays mounted while the author changes conversational surfaces. */
export function EditorWorkspace() {
  const controller = useEditorWorkspace({ mvp: true });
  const [mode, setMode] = useState<MvpMenuMode>("editor");
  const [chatKind, setChatKind] = useState<"chat" | "rules">("chat");
  const [chatBusy, setChatBusy] = useState(false);
  const [selectedRule, setSelectedRule] = useState<string>();
  const [candidateReady, setCandidateReady] = useState<object | null>(null);
  const candidateFrameRef = useRef<HTMLIFrameElement>(null);
  const [confirming, setConfirming] = useState(false);
  const saveDialogRef = useRef<HTMLDialogElement>(null);
  const [playRequested, setPlayRequested] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");
  const [threads, setThreads] = useState([{ id: "general", title: "Работа над игрой" }]);
  const [activeThread, setActiveThread] = useState("general");
  const [drawingRegion, setDrawingRegion] = useState<MvpDrawingRegion>();
  const drawingReturnTo = useRef<"editor" | "chat" | "rules">("chat");
  const [drawingPending, setDrawingPending] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const modeRequestRef = useRef(0);
  const [pencil, setPencil] = useState({ color: "#ef4444", width: 3 });
  const [pageSource, setPageSource] = useState<{ filePath: string; pointer: string }>();
  const [requestedSource, setRequestedSource] = useState<{ filePath: string; pointer: string; requestId: number }>();
  const [attachments, setAttachments] = useState<Record<string, readonly { dataUrl: string; name: string }[]>>({});
  const senderRef = useRef<EditorMessageSender | null>(null);
  const onSenderReady = useCallback((sender: EditorMessageSender | null) => {
    senderRef.current = sender;
    controller.setMvpAgentSender(sender);
  }, [controller.setMvpAgentSender]);
  const lastForwardedCount = useRef(controller.mvpAgentForwardedCount);
  const previousGame = useRef(controller.currentDocument.gameId);
  const debug = useMvpDebugSession({
    catalogKey: debugCatalogKey(controller.currentDocument.gameId, controller.editorSession?.sessionId ?? "unprepared"),
    previewUrl: controller.previewUrl, sessionId: controller.previewRuntimeSessionId,
    iframeRef: controller.previewIframeRef, onRestored: id => { controller.acceptRestoredPreviewSession(id); setMode("editor"); }
  });
  controller.setPreviewPauseHandler(debug.setPaused);
  controller.setPreviewPaused(debug.status?.paused === true && debug.status.sessionId === controller.previewRuntimeSessionId);
  useEffect(() => { controller.mvpVisual.refresh(); }, [debug.status?.paused, debug.status?.sessionId]);
  const threadId = `${controller.currentDocument.gameId}:${chatKind === "rules" ? "rules" : activeThread}`;
  const currentAttachments = attachments[threadId] ?? [];
  const chatVisible = mode === "chat" || mode === "rules";
  const preparedCandidate = controller.pendingMvpMutation?.prepared;
  const candidatePlayerUrl = preparedCandidate?.preview.playerUrl;
  const building = controller.workflowState === "previewing" || controller.workflowState === "compiling";
  const visualPending = controller.mvpVisual.pendingCount > 0;
  const mutationBusy = controller.aiApplyState === "planning" || controller.aiApplyState === "applying";
  const playState = controller.previewUrl === null ? "idle" : debug.status?.paused === false ? "running" : "paused";
  const scenarioEntries = useMemo(() => buildMvpScenarioEntries(controller.viewModel.editorEntityProjection.entities, controller.viewModel.entityProjectionDocuments), [controller.viewModel.editorEntityProjection.entities, controller.viewModel.entityProjectionDocuments]);

  useEffect(() => {
    if (controller.mvpAgentForwardedCount <= lastForwardedCount.current) return;
    lastForwardedCount.current = controller.mvpAgentForwardedCount;
    setMode(chatKind);
  }, [controller.mvpAgentForwardedCount, chatKind]);

  useEffect(() => {
    if (chatKind === "rules" && selectedRule !== undefined && selectedRule !== controller.selectedPreviewEntityId && controller.mvpRuleEntities.some(entity => entity.entityId === selectedRule)) {
      controller.handleChannelEntitySelect(selectedRule);
    }
  }, [chatKind, selectedRule, controller.mvpRuleEntities, controller.selectedPreviewEntityId]);

  function requestCandidateSnapshot(playerUrl: string) {
    const origin = safeUrlOrigin(playerUrl);
    if (origin === undefined) return;
    candidateFrameRef.current?.contentWindow?.postMessage(
      { source: "cubica-editor-web", type: "requestPreviewSnapshot", version: 1 }, origin
    );
  }

  useEffect(() => {
    setCandidateReady(null);
    if (preparedCandidate === undefined || candidatePlayerUrl === undefined) return;
    const expectedOrigin = safeUrlOrigin(candidatePlayerUrl);
    if (expectedOrigin === undefined) return;
    const gameId = controller.currentDocument.gameId;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== candidateFrameRef.current?.contentWindow || event.origin !== expectedOrigin) return;
      if (isPlayerPreviewBridgeReadyMessage(event.data)) {
        requestCandidateSnapshot(candidatePlayerUrl);
      } else if (isPlayerPreviewSessionSnapshotMessage(event.data) && event.data.gameId === gameId) {
        setCandidateReady(preparedCandidate);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [preparedCandidate, candidatePlayerUrl, controller.currentDocument.gameId]);

  useEffect(() => {
    controller.setPreviewInspectMode(mode === "editor" && (controller.previewUrl === null || debug.status?.paused === true) && !debug.busy);
    controller.setPreviewPointSelectionMode(true);
    controller.setEditorMode(mode === "play" ? "preview" : "design");
  }, [mode, controller.previewUrl, debug.status?.paused, debug.busy]);

  useEffect(() => {
    if (previousGame.current === controller.currentDocument.gameId) return;
    previousGame.current = controller.currentDocument.gameId;
    modeRequestRef.current += 1;
    setMode("editor");
    setPlayRequested(false);
    setSaveOpen(false);
    setThreads([{ id: "general", title: "Работа над игрой" }]);
    setActiveThread("general");
    setAttachments({});
    setSelectedRule(undefined);
    setDrawingRegion(undefined);
    setChatKind("chat");
    setWorkspaceError(null);
    setPageSource(undefined);
    setRequestedSource(undefined);
    setProjectMenuOpen(false);
  }, [controller.currentDocument.gameId]);

  useEffect(() => {
    if (!playRequested || visualPending || debug.status === null || debug.busy ||
        controller.previewFreshness !== "fresh" || controller.workflowState !== "ready" ||
        debug.status.sessionId !== controller.previewRuntimeSessionId) return;
    setPlayRequested(false);
    void debug.setPaused(false);
  }, [playRequested, visualPending, debug.status, debug.busy, controller.previewFreshness, controller.workflowState, controller.previewRuntimeSessionId]);

  useEffect(() => {
    if (saveOpen) saveDialogRef.current?.showModal();
    else saveDialogRef.current?.close();
  }, [saveOpen]);

  async function selectMode(next: MvpMenuMode) {
    const requestId = ++modeRequestRef.current;
    setWorkspaceError(null);
    if (next === "chat" || next === "rules") {
      if (chatBusy && next !== chatKind) return;
      setChatKind(next);
      if (next === "rules") {
        const id = selectedRule ?? controller.viewModel.editorEntityProjection.entities.find(entity => entity.kind === "game-root")?.entityId;
        if (id) { setSelectedRule(id); controller.handleChannelEntitySelect(id); }
      }
    }
    if (next === "play") {
      if (visualPending) { setWorkspaceError("Дождитесь проверки правок. При ошибке черновик останется доступным."); return; }
      if (!controller.mvpDocumentReady) {
        setWorkspaceError("Дождитесь загрузки игры и редакторской сессии.");
        return;
      }
      const prototypeExit = await controller.clearMvpPrototypePreview();
      if (requestId !== modeRequestRef.current) return;
      if (!prototypeExit.ok) { setWorkspaceError(prototypeExit.message); return; }
      const sceneExit = await controller.showPreviewScene(undefined);
      if (requestId !== modeRequestRef.current) return;
      if (!sceneExit.ok) { setWorkspaceError(sceneExit.reason ?? "Не удалось вернуться к прохождению."); return; }
      if (debug.status?.paused === false) {
        setMode("play");
        await debug.setPaused(true);
        return;
      }
      if (controller.previewUrl === null || controller.previewFreshness !== "fresh" || controller.workflowState !== "ready") {
        const result = await controller.handlePreview();
        if (requestId !== modeRequestRef.current) return;
        if (!result.ready) {
          setPlayRequested(false);
          setWorkspaceError(result.reason ?? "Игра изменилась во время подготовки. Повторите запуск.");
          return;
        }
        setMode("play");
        setPlayRequested(true);
        return;
      }
      if (debug.status !== null && debug.status.sessionId === controller.previewRuntimeSessionId) {
        if (await debug.setPaused(false) && requestId === modeRequestRef.current) setMode("play");
      } else {
        setMode("play");
        setPlayRequested(true);
      }
      return;
    }
    setPlayRequested(false);
    if (next === "drawing") {
      const frame = controller.previewIframeRef.current?.getBoundingClientRect();
      const rect = controller.previewPromptContext?.kind === "region" ? controller.previewPromptContext.rect : controller.previewEntities.find(item => item.entityId === controller.selectedPreviewEntityId)?.bounds;
      setDrawingRegion(rect !== undefined && frame?.width && frame.height ? { x: rect.x / frame.width, y: rect.y / frame.height, width: rect.width / frame.width, height: rect.height / frame.height } : undefined);
      drawingReturnTo.current = chatVisible ? chatKind : "editor";
    }
    if (debug.status?.paused === false && !await debug.setPaused(true)) return;
    if (requestId !== modeRequestRef.current) return;
    setMode(next);
  }

  useEffect(() => {
    if (mode !== "play" && debug.status?.paused === false && !debug.busy) void debug.setPaused(true);
  }, [mode, debug.status?.paused, debug.busy]);

  useEffect(() => {
    if (controller.pendingMvpMutation && debug.status?.paused === false && !debug.busy) void debug.setPaused(true);
  }, [controller.pendingMvpMutation, debug.status?.paused, debug.busy]);

  async function submitDrawing(submission: MvpDrawingSubmission) {
    if (!senderRef.current) throw new Error("Подключите агента в чате, чтобы отправить рисунок. Черновик сохранён в окне рисования.");
    setDrawingPending(true);
    try {
      const frame = controller.previewIframeRef.current?.getBoundingClientRect();
      const background = !submission.background && frame
        ? await controller.captureMvpPreviewRegion({ x: 0, y: 0, width: frame.width, height: frame.height }) : undefined;
      const message = await drawingAgentMessage(submission, background ?? undefined);
      setAttachments(current => ({ ...current, [threadId]: message.images ?? [] }));
      await senderRef.current(message);
      setMode(drawingReturnTo.current);
    } finally { setDrawingPending(false); }
  }

  function createThread() {
    const id = crypto.randomUUID();
    setThreads(current => [...current, { id, title: `Диалог ${current.length + 1}` }]);
    setActiveThread(id);
  }

  async function addItem(kind: MvpCreateKind) {
    if (debug.status?.paused === false && !await debug.setPaused(true)) return;
    const result = await controller.createMvpItem(kind, pageSource);
    if (!result.ok) { setWorkspaceError(result.message); return; }
    setWorkspaceError(null);
    if (kind === "rule") {
      setSelectedRule(result.entityId);
      setChatKind("rules");
      setMode("rules");
    } else {
      setMode("editor");
      if (result.source !== undefined) setRequestedSource({ ...result.source, requestId: Date.now() });
    }
  }

  return (
    <main className={styles.shell}>
      <EditorAgentRuntimeHooks enabled={controller.agentConnection.copilotReady} context={controller.editorAgentContext} tools={controller.editorAgentTools} />
      {controller.previewSceneActive && !chatVisible ? <p className={styles.sceneNotice} role="status">Просмотр сцены · «Игра» вернёт к прохождению</p> : null}
      <div className={styles.projectMenu} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setProjectMenuOpen(false); }}>
        <button type="button" className={styles.hamburger} aria-label="Выбор игры" title="Выбор игры" aria-expanded={projectMenuOpen} onClick={() => setProjectMenuOpen(open => !open)}>☰</button>
        {projectMenuOpen ? <div className={styles.projectPopover}>
          <select aria-label="Текущая игра" value={controller.currentDocument.gameId} onChange={event => { modeRequestRef.current += 1; controller.handleGameChange(event.target.value); setProjectMenuOpen(false); }}>
            {controller.availableGames.map(game => <option key={game} value={game}>{game}</option>)}
          </select>
          <div className={styles.versionActions}>
            <button type="button" title="Отменить изменение" aria-label="Отменить изменение" disabled={!controller.mvpDocumentReady || controller.aiPatchJournal.length === 0} onClick={controller.handleUndoAiChange}>↶</button>
            <button type="button" title="Повторить изменение" aria-label="Повторить изменение" disabled={!controller.mvpDocumentReady || controller.aiRedoJournal.length === 0} onClick={controller.handleRedoAiChange}>↷</button>
            <button type="button" title="Сохранить версию" aria-label="Сохранить версию" onClick={() => void controller.handleSave()} disabled={!controller.mvpDocumentReady || controller.saveState === "saving"}>▣</button>
          </div>
        </div> : null}
      </div>
      <MvpFloatingMenu
        activeMode={mode} onModeChange={next => void selectMode(next)} playState={playState}
        savedStates={debug.savedStates.map(item => ({ id: item.checkpointId, label: item.label, disabledReason: savedStateUnavailableReason(item) }))}
        onSelectSavedState={id => {
          const state = debug.savedStates.find(item => item.checkpointId === id);
          if (state) void controller.clearMvpPrototypePreview().then(result => {
            if (!result.ok) { setWorkspaceError(result.message); return; }
            return debug.restore(state);
          });
        }}
        onDeleteSavedState={id => {
          const state = debug.savedStates.find(item => item.checkpointId === id);
          if (state) void debug.deleteState(state);
        }}
        scenarioStages={scenarioEntries}
        onSelectScenarioStage={id => {
          const entry = scenarioEntries.find(item => item.id === id);
          if (entry === undefined) return;
          if (entry.selector === undefined) { setWorkspaceError("Этот этап пока не связан с конкретной сценой игры."); return; }
          void selectMode("editor").then(async () => {
            const result = await controller.showPreviewScene(entry.selector);
            if (!result.ok) setWorkspaceError(result.reason ?? "Не удалось показать выбранную сцену.");
          });
        }}
        pencilColor={pencil.color} pencilWidth={pencil.width} onPencilChange={setPencil}
        addEntries={[{ id: "rule", label: "Правило" }, { id: "page", label: "Страница" }, { id: "element", label: "Элемент на странице" }, ...controller.mvpPrototypeEntries.map(item => ({ ...item, id: `prototype:${item.id}` }))].map(item => ({ ...item, disabledReason: !controller.mvpDocumentReady || mutationBusy ? "Дождитесь загрузки или сохранения игры" : undefined }))}
        onAddEntry={id => void addItem(id as MvpCreateKind)}
        canSaveState={controller.mvpDocumentReady && debug.status !== null && !controller.previewSceneActive && !debug.busy && !building && !visualPending && !controller.pendingMvpMutation}
        onSaveState={() => { setSaveLabel(`Состояние ${debug.savedStates.length + 1}`); setSaveOpen(true); }}
        disabledModes={{ ...(chatBusy ? { chat: "Дождитесь ответа агента", rules: "Дождитесь ответа агента" } : {}), ...(!controller.mvpDocumentReady ? { play: "Дождитесь загрузки игры" } : visualPending ? { play: "Проверяем изменения" } : mutationBusy ? { play: "Дождитесь применения изменения" } : controller.pendingMvpMutation ? { play: "Сначала примените или отмените предложенное изменение" } : debug.busy ? { play: "Дождитесь подтверждения отладки" } : building ? { play: "Подготавливаем текущую игру" } : {}) }}
      />
      {visualPending || controller.mvpVisual.displayError || controller.mvpVisual.failedDrafts.length > 0 ?
        <aside role="status" aria-label="Проверка изменений" style={{ position: "absolute", bottom: 8, left: 8, zIndex: 40,
          maxWidth: 400, maxHeight: "30vh", overflow: "auto", padding: "4px 8px", background: "rgba(255,255,255,.94)", color: "#17202a", fontSize: 12 }}>
          {visualPending && !controller.mvpVisual.needsPreviewRefresh ? <span>Проверяем изменения: {controller.mvpVisual.pendingCount}</span> : null}
          {controller.mvpVisual.needsPreviewRefresh ? <div>Изменения сохранены. Не удалось обновить предпросмотр.{" "}
            <button type="button" disabled={building} onClick={() => void controller.refreshMvpVisualPreview()}>Обновить предпросмотр</button></div> : null}
          {controller.mvpVisual.displayError ? <div>{controller.mvpVisual.displayError}{" "}
            <button type="button" onClick={controller.mvpVisual.retry}>Повторить проверку</button></div> : null}
          {controller.mvpVisual.failedDrafts.map(entry => <details key={entry.operationId}>
            <summary>{entry.changeSet.summary}: правка не применена</summary>
            <p>Источник изменился или проверка не прошла. Откройте элемент заново; введённые значения сохранены ниже.</p>
            <pre>{entry.changeSet.jsonPatches.flatMap(patch => patch.operations.filter(op => op.op !== "test").map(op =>
              `${op.path.split("/").at(-1)}: ${"value" in op ? JSON.stringify(op.value) : "удалено"}`)).join("\n")}</pre>
            <button type="button" onClick={() => controller.mvpVisual.dismiss(entry.operationId)}>Закрыть</button>
          </details>)}
        </aside> : null}
      <div className={styles.workArea}>
        <div className={styles.preview} hidden={chatVisible} aria-busy={mode === "play" && debug.busy}
          style={{ pointerEvents: mode === "play" && debug.busy ? "none" : undefined }}>
          <PreviewStage controller={controller} onPageSourceChange={setPageSource} requestedSource={requestedSource} onStartDrawing={rect => {
            const frame = controller.previewIframeRef.current?.getBoundingClientRect();
            if (!frame?.width || !frame.height) return;
            setDrawingRegion({ x: rect.x / frame.width, y: rect.y / frame.height, width: rect.width / frame.width, height: rect.height / frame.height });
            drawingReturnTo.current = "editor";
            setMode("drawing");
          }} />
          {mode === "drawing" ? <MvpDrawing className={styles.drawing}
            pencilColor={pencil.color} pencilWidth={pencil.width}
            onSubmit={submitDrawing} pending={drawingPending} region={drawingRegion}
            disabled={debug.status?.paused === false || debug.busy} /> : null}
        </div>
        <section hidden={!chatVisible} className={styles.chat} aria-label={chatKind === "rules" ? "Чат о правилах игры" : "Чат с агентом"}>
            <aside className={styles.conversations} aria-label="Диалоги">
              <h2>{chatKind === "rules" ? "Правила" : "Диалоги"}</h2>
              {chatKind === "chat" ? <>
                <button type="button" disabled={chatBusy} onClick={createThread}>＋ Новый диалог</button>
                {threads.map(thread => <button type="button" key={thread.id} aria-current={activeThread === thread.id ? "true" : undefined} disabled={chatBusy} onClick={() => setActiveThread(thread.id)}>{thread.title}</button>)}
              </> : <p>Отдельный диалог о правилах текущей игры.</p>}
            </aside>
            <div className={styles.messages}>
              <EditorCopilotChatPanel
                enabled={controller.agentConnection.copilotReady} connection={controller.agentConnection}
                onSenderReady={onSenderReady} onBusyChange={setChatBusy} onSendError={setWorkspaceError}
                threadId={threadId}
                title={chatKind === "rules" ? "Обсуждение правил" : "Работа над игрой"}
                onCollapse={() => void selectMode("editor")} tools={controller.editorAgentTools}
                fallback={<div className={styles.emptyChat}><h1>{chatKind === "rules" ? "Обсудим правила игры" : "Что изменим в игре?"}</h1><p>{controller.agentConnection.message}</p></div>}
              />
            </div>
            <aside className={styles.documents} aria-label="Материалы диалога">
              {chatKind === "rules" ? <MvpRulesPanel
                entities={controller.mvpRuleEntities}
                documents={controller.viewModel.entityProjectionDocuments}
                selectedEntityId={selectedRule}
                onSelectEntity={id => { setSelectedRule(id); controller.handleChannelEntitySelect(id); }}
                onApply={controller.directMvpMutation}
                preparedDocuments={controller.pendingMvpMutation?.prepared.documents}
                disabled={confirming || Boolean(controller.pendingMvpMutation)}
              /> : <><h2>Материалы</h2>
              {currentAttachments.length ? currentAttachments.map((attachment, index) => <figure key={index}><img src={attachment.dataUrl} alt={attachment.name === "drawing-overlay.png" ? "Рисунок и надписи" : "Исходное изображение"} /><figcaption>{attachment.name === "drawing-overlay.png" ? "Рисунок" : "Изображение"}</figcaption></figure>) : <p>Здесь отображаются изображения, отправленные агенту из режима рисования.</p>}</>}

            </aside>
          </section>
        {controller.pendingMvpMutation ? <section className={`${styles.candidate} ${chatVisible ? styles.candidateInChat : ""}`} aria-label="Предложенное изменение">
          <iframe ref={candidateFrameRef} key={controller.pendingMvpMutation.prepared.effectDigest} title="Предпросмотр предложенного изменения" src={controller.pendingMvpMutation.prepared.preview.playerUrl}
            sandbox="allow-scripts allow-same-origin" onLoad={() => { if (candidatePlayerUrl !== undefined) requestCandidateSnapshot(candidatePlayerUrl); }} />
          <div className={styles.candidateActions}>
            <p>{controller.pendingMvpMutation.prepared.summary}{" "}{mvpSharedChangeImpact(controller.pendingMvpMutation.plan.changeSet, controller.viewModel.entityProjectionDocuments)}</p>
            <button type="button" disabled={confirming} onClick={controller.cancelMvpMutation}>Отмена</button>
            <button type="button" disabled={confirming || candidateReady !== controller.pendingMvpMutation.prepared} onClick={() => { setConfirming(true); void controller.confirmMvpMutation().finally(() => setConfirming(false)); }}>Применить изменение</button>
          </div>
        </section> : null}
        <div className={styles.notices} aria-live="polite">
          <SessionRecoveryBanner changedPaths={controller.sessionRecoveryPaths} onDismiss={controller.dismissSessionRecovery} />
          {!visualPending && (building ? <p role="status">Обновляем игру… Можно продолжать редактирование.</p> : mutationBusy ? <p role="status">Проверяем изменение…</p> : null)}
          {workspaceError ? <p role="alert">{workspaceError}</p> : controller.workflowState === "error" || controller.workflowState === "blocked" || controller.aiApplyState === "blocked" ? <p role="alert">{controller.statusMessage}</p> : null}
          {debug.error ? <p role="alert">{debug.error} <button type="button" aria-label="Закрыть сообщение" onClick={debug.dismissError}>×</button></p> : null}
          {debug.incompatibleState ? <p role="alert">{debug.incompatibleState.reason} Удалить снимок «{debug.incompatibleState.state.label}»?
            <button type="button" disabled={debug.busy} onClick={() => { if (debug.incompatibleState !== null) void debug.deleteState(debug.incompatibleState.state); }}>Удалить</button>
            <button type="button" onClick={debug.dismissIncompatibleState}>Оставить</button>
          </p> : null}
        </div>
      </div>
      <dialog ref={saveDialogRef} className={styles.saveDialog} aria-labelledby="save-state-title" onClose={() => setSaveOpen(false)} onCancel={() => setSaveOpen(false)}>
        <form onSubmit={event => {
          event.preventDefault();
          void debug.save(saveLabel.trim()).then(ok => { if (ok) setSaveOpen(false); });
        }}>
          <h2 id="save-state-title">Сохранить прохождение</h2>
          <label>Название<input autoFocus maxLength={120} value={saveLabel} onChange={event => setSaveLabel(event.target.value)} /></label>
          <p>Игра будет приостановлена. Состояние можно восстановить, пока оно совместимо с моделью игры.</p>
          <div><button type="button" onClick={() => setSaveOpen(false)}>Отмена</button><button type="submit" disabled={debug.busy || !saveLabel.trim()}>Сохранить состояние</button></div>
        </form>
      </dialog>
    </main>
  );
}
