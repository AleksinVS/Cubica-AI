/**
 * Top toolbar for the editor workspace.
 *
 * Renders the preview mode (Игра/Осмотр) and viewport segmented controls, the
 * game/file selectors, and the workflow action buttons (Сброс, Сохранить,
 * Отменить/Повторить, Проверить, Собрать, Предпросмотр). It is purely
 * presentational: every value and handler is read from the
 * {@link EditorWorkspaceController}; every user-facing string comes from the
 * Russian chrome locale (@/lib/locale, TSK-20260708).
 */
import { editorRu as t } from "@/lib/locale";

import type { EditorWorkspaceController } from "./use-editor-workspace.ts";

export function EditorToolbar({ controller }: { controller: EditorWorkspaceController }) {
  const {
    editorMode,
    setEditorMode,
    effectivePreviewInspectMode,
    setPreviewInspectMode,
    setAltPlayActive,
    setPreviewPointerPlayMode,
    setPreviewPointSelectionMode,
    clearPreviewPointerPlayReset,
    setPreviewPromptContext,
    setPreviewAiIntent,
    setPropertyPanelOpen,
    previewViewportMode,
    setPreviewViewportMode,
    availableGames,
    currentDocument,
    handleGameChange,
    availableFiles,
    handleFileChange,
    resetCurrentFile,
    loadState,
    handleSave,
    isDirty,
    hasBlockingDiagnostics,
    saveState,
    handleUndoAiChange,
    aiPatchJournal,
    aiApplyState,
    handleRedoAiChange,
    aiRedoJournal,
    handleValidate,
    workflowState,
    handleCompile,
    hasLocalSchemaBlockingDiagnostics,
    handlePreview,
    checkCounts
  } = controller;

  // Вариант А (TSK-20260708): when an action is blocked purely by blocking
  // diagnostics, explain why (error count) instead of leaving a silently
  // disabled button. Clicking the status/checks counter jumps to the first
  // error. The gate invariant itself is unchanged.
  const blockedTitle = hasBlockingDiagnostics ? t.toolbar.blockedByErrors(checkCounts.error) : undefined;

  return (
    <header className="top-toolbar" aria-label={t.toolbar.toolbarAria}>
      <div className="toolbar-title">
        <strong>{t.toolbar.brand}</strong>
      </div>
      <div className="toolbar-actions">
        {/* Design/Preview axis (ADR-057 §4.8; design-spec §3.3). Top-level mode
            that governs the edit-apply policy; orthogonal to Игра/Осмотр. */}
        <div className="segmented-control mode-control" role="group" aria-label={t.toolbar.editorModeAria}>
          <button
            type="button"
            className={editorMode === "design" ? "is-active" : ""}
            aria-pressed={editorMode === "design"}
            onClick={() => setEditorMode("design")}
          >
            {t.toolbar.modeDesign}
          </button>
          <button
            type="button"
            className={editorMode === "preview" ? "is-active" : ""}
            aria-pressed={editorMode === "preview"}
            onClick={() => setEditorMode("preview")}
          >
            {t.toolbar.modePreview}
          </button>
        </div>
        <div className="segmented-control" role="group" aria-label={t.toolbar.previewModeAria}>
          <button
            type="button"
            className={!effectivePreviewInspectMode ? "is-active" : ""}
            aria-pressed={!effectivePreviewInspectMode}
            onClick={() => {
              setPreviewInspectMode(false);
              setAltPlayActive(false);
              setPreviewPointerPlayMode(false);
              setPreviewPointSelectionMode(false);
              clearPreviewPointerPlayReset();
              setPreviewPromptContext(null);
              setPreviewAiIntent(null);
              setPropertyPanelOpen(false);
            }}
          >
            {t.toolbar.play}
          </button>
          <button
            type="button"
            className={effectivePreviewInspectMode ? "is-active" : ""}
            aria-pressed={effectivePreviewInspectMode}
            onClick={() => {
              setPreviewPointerPlayMode(false);
              clearPreviewPointerPlayReset();
              setPreviewInspectMode(true);
            }}
          >
            {t.toolbar.inspect}
          </button>
        </div>
        <div className="segmented-control viewport-control" role="group" aria-label={t.toolbar.viewportAria}>
          {(["desktop", "tablet", "mobile"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={previewViewportMode === mode ? "is-active" : ""}
              aria-pressed={previewViewportMode === mode}
              onClick={() => setPreviewViewportMode(mode)}
            >
              {mode === "desktop"
                ? t.toolbar.viewportDesktop
                : mode === "tablet"
                  ? t.toolbar.viewportTablet
                  : t.toolbar.viewportMobile}
            </button>
          ))}
        </div>
        <select
          aria-label={t.toolbar.gameAria}
          disabled={availableGames.length === 0}
          value={currentDocument.source === "repository" ? currentDocument.gameId : ""}
          onChange={(event) => handleGameChange(event.target.value)}
        >
          {availableGames.length === 0 ? <option value="">{t.toolbar.embedded}</option> : null}
          {availableGames.map((gameId) => (
            <option value={gameId} key={gameId}>
              {gameId}
            </option>
          ))}
        </select>
        <select
          aria-label={t.toolbar.fileAria}
          disabled={availableFiles.length === 0}
          value={currentDocument.source === "repository" ? currentDocument.filePath : ""}
          onChange={(event) => handleFileChange(event.target.value)}
        >
          {availableFiles.length === 0 ? <option value="">{t.toolbar.embeddedSample}</option> : null}
          {availableFiles.map((file) => (
            <option value={file.filePath} key={`${file.gameId}:${file.filePath}`}>
              {file.filePath}
            </option>
          ))}
        </select>
        <button type="button" onClick={resetCurrentFile} disabled={loadState === "loading"}>
          {t.toolbar.reset}
        </button>
        <button
          type="button"
          onClick={handleSave}
          title={blockedTitle}
          disabled={
            currentDocument.source !== "repository" ||
            !isDirty ||
            hasBlockingDiagnostics ||
            saveState === "saving" ||
            loadState === "loading"
          }
        >
          {t.toolbar.save}
        </button>
        <button type="button" onClick={handleUndoAiChange} disabled={aiPatchJournal.length === 0 || aiApplyState === "planning" || aiApplyState === "applying"}>
          {t.toolbar.undo}
        </button>
        <button type="button" onClick={handleRedoAiChange} disabled={aiRedoJournal.length === 0 || aiApplyState === "planning" || aiApplyState === "applying"}>
          {t.toolbar.redo}
        </button>
        <button type="button" onClick={handleValidate} disabled={currentDocument.source !== "repository" || workflowState === "validating"}>
          {t.toolbar.validate}
        </button>
        <button
          type="button"
          onClick={handleCompile}
          title={blockedTitle}
          disabled={
            currentDocument.source !== "repository" ||
            isDirty ||
            hasLocalSchemaBlockingDiagnostics ||
            workflowState === "compiling" ||
            workflowState === "previewing"
          }
        >
          {t.toolbar.compile}
        </button>
        <button
          type="button"
          onClick={handlePreview}
          title={blockedTitle}
          disabled={
            currentDocument.source !== "repository" ||
            isDirty ||
            hasLocalSchemaBlockingDiagnostics ||
            workflowState === "compiling" ||
            workflowState === "previewing"
          }
        >
          {t.toolbar.preview}
        </button>
      </div>
    </header>
  );
}
