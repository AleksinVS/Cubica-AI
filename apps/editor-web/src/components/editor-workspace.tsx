"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import styles from "@/components/workspace/mvp-workspace.module.css";

/** The preview stays mounted while the author changes conversational surfaces. */
export function EditorWorkspace() {
  const controller = useEditorWorkspace({ mvp: true });
  const [mode, setMode] = useState<MvpMenuMode>("editor");
  const [chatKind, setChatKind] = useState<"chat" | "rules">("chat");
  const [chatBusy, setChatBusy] = useState(false);
  const [selectedRule, setSelectedRule] = useState<string>();
  const [candidateLoaded, setCandidateLoaded] = useState<string>();
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
  const [attachments, setAttachments] = useState<Record<string, readonly { dataUrl: string; name: string }[]>>({});
  const senderRef = useRef<EditorMessageSender | null>(null);
  const onSenderReady = useCallback((sender: EditorMessageSender | null) => { senderRef.current = sender; }, []);
  const previousGame = useRef(controller.currentDocument.gameId);
  const debug = useMvpDebugSession({
    catalogKey: debugCatalogKey(controller.currentDocument.gameId, controller.editorSession?.sessionId ?? "unprepared"),
    previewUrl: controller.previewUrl, sessionId: controller.previewRuntimeSessionId,
    iframeRef: controller.previewIframeRef, onRestored: id => { controller.acceptRestoredPreviewSession(id); setMode("editor"); }
  });
  const threadId = `${controller.currentDocument.gameId}:${chatKind === "rules" ? "rules" : activeThread}`;
  const currentAttachments = attachments[threadId] ?? [];
  const chatVisible = mode === "chat" || mode === "rules";
  const building = controller.workflowState === "previewing" || controller.workflowState === "compiling";
  const mutationBusy = controller.aiApplyState === "planning" || controller.aiApplyState === "applying";
  const playState = controller.previewUrl === null ? "idle" : debug.status?.paused === false ? "running" : "paused";

  useEffect(() => {
    controller.setPreviewInspectMode(mode === "editor" && (controller.previewUrl === null || debug.status?.paused === true) && !debug.busy);
    controller.setPreviewPointSelectionMode(true);
    controller.setEditorMode(mode === "play" ? "preview" : "design");
  }, [mode, controller.previewUrl, debug.status?.paused, debug.busy]);

  useEffect(() => {
    if (previousGame.current === controller.currentDocument.gameId) return;
    previousGame.current = controller.currentDocument.gameId;
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
  }, [controller.currentDocument.gameId]);

  useEffect(() => {
    if (!playRequested || debug.status === null || debug.busy) return;
    setPlayRequested(false);
    void debug.setPaused(false);
  }, [playRequested, debug.status, debug.busy]);

  useEffect(() => {
    if (saveOpen) saveDialogRef.current?.showModal();
    else saveDialogRef.current?.close();
  }, [saveOpen]);

  async function selectMode(next: MvpMenuMode) {
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
      setMode("play");
      if (controller.previewUrl === null) {
        setPlayRequested(true);
        const result = await controller.handlePreview();
        if (!result.ready) { setPlayRequested(false); setMode("editor"); setWorkspaceError("Не удалось запустить игру. Исправьте ошибки и повторите запуск."); }
      } else if (debug.status !== null) {
        await debug.setPaused(!debug.status.paused);
      } else { setPlayRequested(true); }
      return;
    }
    setPlayRequested(false);
    if (next === "drawing") { setDrawingRegion(undefined); drawingReturnTo.current = chatKind; }
    if (debug.status?.paused === false && !await debug.setPaused(true)) return;
    setMode(next);
  }

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

  return (
    <main className={styles.shell}>
      <EditorAgentRuntimeHooks enabled={controller.agentConnection.copilotReady} context={controller.editorAgentContext} tools={controller.editorAgentTools} />
      <MvpFloatingMenu
        activeMode={mode} onModeChange={next => void selectMode(next)} playState={playState}
        savedStates={debug.savedStates.map(item => ({ id: item.checkpointId, label: item.label, disabledReason: savedStateUnavailableReason(item) }))}
        onSelectSavedState={id => {
          const state = debug.savedStates.find(item => item.checkpointId === id);
          if (state) void debug.restore(state);
        }}
        onDeleteSavedState={id => {
          const state = debug.savedStates.find(item => item.checkpointId === id);
          if (state) void debug.deleteState(state);
        }}
        scenarioStages={controller.viewModel.editorEntityProjection.entities.filter(entity => entity.kind === "game-step").map(entity => ({ id: entity.entityId, label: entity.label }))}
        onSelectScenarioStage={id => { void selectMode("editor"); controller.handleChannelEntitySelect(id); }}
        onRefreshSavedStates={() => void debug.refresh()}
        canSaveState={debug.status !== null && !debug.busy && !building && !controller.pendingMvpMutation}
        onSaveState={() => { setSaveLabel(`Состояние ${debug.savedStates.length + 1}`); setSaveOpen(true); }}
        disabledModes={{ ...(chatBusy ? { chat: "Дождитесь ответа агента", rules: "Дождитесь ответа агента" } : {}), ...(mutationBusy ? { play: "Дождитесь применения изменения" } : controller.pendingMvpMutation ? { play: "Сначала примените или отмените предложенное изменение" } : debug.busy ? { play: "Дождитесь подтверждения отладки" } : building ? { play: "Подготавливаем текущую игру" } : {}) }}
      />
      <div className={styles.workArea}>
        <div className={styles.preview} hidden={chatVisible}>
          <PreviewStage controller={controller} onStartDrawing={rect => {
            const frame = controller.previewIframeRef.current?.getBoundingClientRect();
            if (!frame?.width || !frame.height) return;
            setDrawingRegion({ x: rect.x / frame.width, y: rect.y / frame.height, width: rect.width / frame.width, height: rect.height / frame.height });
            drawingReturnTo.current = "editor";
            setMode("drawing");
          }} />
          {mode === "drawing" ? <MvpDrawing className={styles.drawing}
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
                entities={controller.viewModel.editorEntityProjection.entities}
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
          <iframe key={controller.pendingMvpMutation.prepared.effectDigest} title="Предпросмотр предложенного изменения" src={controller.pendingMvpMutation.prepared.preview.playerUrl}
            sandbox="allow-scripts allow-same-origin" onLoad={() => setCandidateLoaded(controller.pendingMvpMutation?.prepared.effectDigest)} />
          <div className={styles.candidateActions}>
            <p>{controller.pendingMvpMutation.prepared.summary}</p>
            <button type="button" disabled={confirming} onClick={controller.cancelMvpMutation}>Отмена</button>
            <button type="button" disabled={confirming || candidateLoaded !== controller.pendingMvpMutation.prepared.effectDigest} onClick={() => { setConfirming(true); void controller.confirmMvpMutation().finally(() => setConfirming(false)); }}>Применить изменение</button>
          </div>
        </section> : null}
        <div className={styles.notices} aria-live="polite">
          <SessionRecoveryBanner changedPaths={controller.sessionRecoveryPaths} onDismiss={controller.dismissSessionRecovery} />
          {building ? <p role="status">Обновляем игру… Можно продолжать редактирование.</p> : mutationBusy ? <p role="status">Проверяем изменение…</p> : null}
          {workspaceError ? <p role="alert">{workspaceError}</p> : controller.workflowState === "error" || controller.aiApplyState === "blocked" ? <p role="alert">{controller.statusMessage}</p> : null}
          {debug.error ? <p role="alert">{debug.error} <button type="button" aria-label="Закрыть сообщение" onClick={debug.dismissError}>×</button></p> : null}
        </div>
      </div>
      <footer className={styles.projectBar}>
        <select aria-label="Текущая игра" value={controller.currentDocument.gameId} onChange={event => controller.handleGameChange(event.target.value)}>
          {controller.availableGames.map(game => <option key={game} value={game}>{game}</option>)}
        </select>
        <span className={styles.stateLabel}>{controller.previewUrl === null ? "Структурный макет" : debug.status?.paused ? "Пауза" : "Предпросмотр"}</span>
        <div className={styles.versionActions}>
          <button type="button" title="Отменить изменение" aria-label="Отменить изменение" disabled={controller.aiPatchJournal.length === 0} onClick={controller.handleUndoAiChange}>↶</button>
          <button type="button" title="Повторить изменение" aria-label="Повторить изменение" disabled={controller.aiRedoJournal.length === 0} onClick={controller.handleRedoAiChange}>↷</button>
          <button type="button" onClick={() => void controller.handleSave()} disabled={controller.saveState === "saving"}>Сохранить версию</button>
        </div>
      </footer>
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
