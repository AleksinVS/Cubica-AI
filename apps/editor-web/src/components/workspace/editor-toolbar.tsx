/**
 * Top toolbar for the editor workspace.
 *
 * Renders the preview mode (Play/Inspect) and viewport segmented controls, the
 * game/file selectors, and the workflow action buttons (Reset, Save, Undo/Redo,
 * Validate, Compile, Preview). It is purely presentational: every value and
 * handler is read from the {@link EditorWorkspaceController}.
 */
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
    handlePreview
  } = controller;

  return (
    <header className="top-toolbar" aria-label="Editor toolbar">
      <div className="toolbar-title">
        <strong>Cubica Editor</strong>
      </div>
      <div className="toolbar-actions">
        {/* Design/Preview axis (ADR-057 §4.8; design-spec §3.3). Top-level mode
            that governs the edit-apply policy; orthogonal to Play/Inspect. */}
        <div className="segmented-control mode-control" role="group" aria-label="Editor mode">
          <button
            type="button"
            className={editorMode === "design" ? "is-active" : ""}
            aria-pressed={editorMode === "design"}
            onClick={() => setEditorMode("design")}
          >
            Дизайн
          </button>
          <button
            type="button"
            className={editorMode === "preview" ? "is-active" : ""}
            aria-pressed={editorMode === "preview"}
            onClick={() => setEditorMode("preview")}
          >
            Превью
          </button>
        </div>
        <div className="segmented-control" role="group" aria-label="Preview mode">
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
            Play
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
            Inspect
          </button>
        </div>
        <div className="segmented-control viewport-control" role="group" aria-label="Preview viewport">
          {(["desktop", "tablet", "mobile"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={previewViewportMode === mode ? "is-active" : ""}
              aria-pressed={previewViewportMode === mode}
              onClick={() => setPreviewViewportMode(mode)}
            >
              {mode === "desktop" ? "Desktop" : mode === "tablet" ? "Tablet" : "Mobile"}
            </button>
          ))}
        </div>
        <select
          aria-label="Game"
          disabled={availableGames.length === 0}
          value={currentDocument.source === "repository" ? currentDocument.gameId : ""}
          onChange={(event) => handleGameChange(event.target.value)}
        >
          {availableGames.length === 0 ? <option value="">embedded</option> : null}
          {availableGames.map((gameId) => (
            <option value={gameId} key={gameId}>
              {gameId}
            </option>
          ))}
        </select>
        <select
          aria-label="Authoring file"
          disabled={availableFiles.length === 0}
          value={currentDocument.source === "repository" ? currentDocument.filePath : ""}
          onChange={(event) => handleFileChange(event.target.value)}
        >
          {availableFiles.length === 0 ? <option value="">embedded sample</option> : null}
          {availableFiles.map((file) => (
            <option value={file.filePath} key={`${file.gameId}:${file.filePath}`}>
              {file.filePath}
            </option>
          ))}
        </select>
        <button type="button" onClick={resetCurrentFile} disabled={loadState === "loading"}>
          Reset
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={
            currentDocument.source !== "repository" ||
            !isDirty ||
            hasBlockingDiagnostics ||
            saveState === "saving" ||
            loadState === "loading"
          }
        >
          Save
        </button>
        <button type="button" onClick={handleUndoAiChange} disabled={aiPatchJournal.length === 0 || aiApplyState === "planning" || aiApplyState === "applying"}>
          Undo
        </button>
        <button type="button" onClick={handleRedoAiChange} disabled={aiRedoJournal.length === 0 || aiApplyState === "planning" || aiApplyState === "applying"}>
          Redo
        </button>
        <button type="button" onClick={handleValidate} disabled={currentDocument.source !== "repository" || workflowState === "validating"}>
          Validate
        </button>
        <button
          type="button"
          onClick={handleCompile}
          disabled={
            currentDocument.source !== "repository" ||
            isDirty ||
            hasLocalSchemaBlockingDiagnostics ||
            workflowState === "compiling" ||
            workflowState === "previewing"
          }
        >
          Compile
        </button>
        <button
          type="button"
          onClick={handlePreview}
          disabled={
            currentDocument.source !== "repository" ||
            isDirty ||
            hasLocalSchemaBlockingDiagnostics ||
            workflowState === "compiling" ||
            workflowState === "previewing"
          }
        >
          Preview
        </button>
      </div>
    </header>
  );
}
