/**
 * Preview stage: the embedded player iframe and inspect overlay.
 *
 * When a preview is prepared it renders the player in an iframe with the
 * {@link PreviewSelectionOverlay} on top (for Inspect selection / region prompts);
 * otherwise it shows the empty state with a "Prepare preview" button.
 * Presentational: all state and handlers come from the {@link EditorWorkspaceController}.
 */
import { useMemo } from "react";

import { PreviewSelectionOverlay } from "@/components/preview-selection-overlay";
import { EntityInspector } from "@/components/workspace/entity-inspector";

import type { EditorWorkspaceController } from "./use-editor-workspace.ts";

export function PreviewStage({ controller }: { controller: EditorWorkspaceController }) {
  const {
    previewViewportMode,
    previewUrl,
    previewIframeRef,
    effectivePreviewInspectMode,
    previewEntities,
    selectedPreviewEntityId,
    previewPointSelectionMode,
    previewPromptContext,
    previewAiIntent,
    previewUnresolvedEntityCount,
    handlePreviewEntitySelect,
    handlePreviewRegionSelect,
    setSelectedPreviewEntityId,
    setPreviewPromptContext,
    setPreviewAiIntent,
    handlePreviewPromptSubmit,
    handlePreviewTemporaryPlayChange,
    selectedNode,
    handlePreview,
    currentDocument,
    isDirty,
    hasLocalSchemaBlockingDiagnostics,
    workflowState,
    viewModel,
    activeChannel,
    inspectorEntityId,
    handleInspectorClose,
    handlePropertyChange,
    handleFileChange,
    aiDiffSummary
  } = controller;

  // The entity the inspector shows (Phase 3.c). `undefined` -> the panel renders
  // only its (inert) measurement layer, so nothing floats over the preview.
  const inspectorEntity =
    inspectorEntityId === undefined ? undefined : viewModel.editorEntityProjection.entityById.get(inspectorEntityId);
  // Bounds of the selected preview object, so the panel can dodge the selection.
  const inspectorBounds =
    selectedPreviewEntityId === undefined
      ? undefined
      : previewEntities.find((entity) => entity.entityId === selectedPreviewEntityId)?.bounds;
  // Pointers the last applied agent ChangeSet touched -> the `.hl` "изменено
  // агентом" highlight. `aiDiffSummary` is the ready signal (set after dry-run /
  // apply, cleared by `clearAiSessionState` on the next manual edit).
  const changedPointerKeys = useMemo(
    () => new Set(aiDiffSummary.map((item) => `${item.filePath}#${item.pointer}`)),
    [aiDiffSummary]
  );

  return (
    <section className="preview-stage" aria-label="Game preview">
      <div className={`preview-frame-shell preview-viewport-${previewViewportMode}`}>
        {previewUrl !== null ? (
          <div className="preview-viewport-canvas">
            <iframe ref={previewIframeRef} title="Game preview" src={previewUrl} allow="fullscreen" />
            <PreviewSelectionOverlay
              disabled={!effectivePreviewInspectMode}
              entities={previewEntities}
              selectedEntityId={selectedPreviewEntityId}
              pointSelectionEnabled={previewPointSelectionMode}
              promptContext={previewPromptContext}
              proposedIntent={previewAiIntent}
              unresolvedCount={previewUnresolvedEntityCount}
              onSelectEntity={handlePreviewEntitySelect}
              onSelectRegion={handlePreviewRegionSelect}
              onClearContext={() => {
                setSelectedPreviewEntityId(undefined);
                setPreviewPromptContext(null);
                setPreviewAiIntent(null);
              }}
              onPromptDraftChange={(draft) =>
                setPreviewPromptContext((current) => (current === null ? current : { ...current, draft }))
              }
              onPromptSubmit={handlePreviewPromptSubmit}
              onPromptClose={() => {
                setPreviewPromptContext(null);
                setPreviewAiIntent(null);
              }}
              onTemporaryPlayChange={handlePreviewTemporaryPlayChange}
            />
          </div>
        ) : (
          <div className="preview-empty-state">
            <strong>{selectedNode?.semanticTitle ?? "No selection"}</strong>
            <span>{selectedNode?.pointer ?? "/"}</span>
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
              Prepare preview
            </button>
          </div>
        )}
        <EntityInspector
          entity={inspectorEntity}
          documents={viewModel.entityProjectionDocuments}
          activeChannel={activeChannel}
          currentFilePath={currentDocument.filePath}
          selectionBounds={inspectorBounds}
          changedPointerKeys={changedPointerKeys}
          onClose={handleInspectorClose}
          onFieldEdit={(field, rawValue) =>
            handlePropertyChange(
              { pointer: field.pointer, label: "", value: field.value, valueType: field.valueType, editable: true, enumValues: undefined },
              rawValue
            )
          }
          onOpenFile={handleFileChange}
        />
      </div>
    </section>
  );
}
