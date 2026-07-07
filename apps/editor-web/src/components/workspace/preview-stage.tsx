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
import { DeleteEntityDialog, RenameEntityIdDialog } from "@/components/workspace/entity-refactor-dialog";
import { PreviewModeBanner } from "@/components/workspace/preview-mode-banner";
import { formatPreviewUnbuiltMessage } from "@/components/workspace/workspace-helpers";

import type { EditorWorkspaceController } from "./use-editor-workspace.ts";

export function PreviewStage({ controller }: { controller: EditorWorkspaceController }) {
  const {
    editorMode,
    currentPreviewTraceEvent,
    canApplyEditsToPreview,
    handleApplyEditsToPreview,
    stateFixtures,
    selectedFixtureId,
    handleSelectFixture,
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
    captureEntitySource,
    applyEntityReturnedIntent,
    entityRefactorDialog,
    closeEntityRefactorDialog,
    handleRequestDeleteEntity,
    handleRequestRenameEntity,
    handleCreateEntityView,
    confirmDeleteEntity,
    confirmRenameEntityId,
    handlePropertyChange,
    handleFileChange,
    beginAssetPick,
    handleUploadAsset,
    aiDiffSummary,
    previewBlockedPlate,
    handleNavigateToFirstError
  } = controller;

  // Refactor affordances only when there is a worktree to persist sibling facets
  // into (a repository session); the embedded fallback hides them, mirroring the
  // «+» create menu's `canCreateEntity` gate.
  const canRefactorEntity = currentDocument.source === "repository";

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
            {/* Mode plate + apply state (design-spec §3.3, mockup zone 3). */}
            <PreviewModeBanner
              editorMode={editorMode}
              stepLabel={currentPreviewTraceEvent !== undefined ? `T${currentPreviewTraceEvent.sequence}` : undefined}
              playthroughRunning={(currentPreviewTraceEvent?.sequence ?? 0) > 0}
              canApply={canApplyEditsToPreview}
              onApply={handleApplyEditsToPreview}
              fixtures={stateFixtures}
              selectedFixtureId={selectedFixtureId}
              onSelectFixture={handleSelectFixture}
              blockedPlate={
                previewBlockedPlate !== null && previewBlockedPlate.hasLastValidSnapshot
                  ? {
                      editsSincePreview: previewBlockedPlate.editsSincePreview,
                      blockingErrorCount: previewBlockedPlate.blockingErrorCount,
                      canNavigateToError: previewBlockedPlate.canNavigateToError,
                      onNavigateToError: handleNavigateToFirstError
                    }
                  : undefined
              }
            />
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
        ) : previewBlockedPlate !== null && !previewBlockedPlate.hasLastValidSnapshot ? (
          // First compile is broken and there is NO valid snapshot to keep on
          // screen (ADR-057 §4.12; §9.6 "пустой экран запрещён"): an explanatory
          // message + a jump to the first blocking error, never a blank canvas.
          <div className="preview-empty-state preview-empty-state-blocked" data-testid="preview-blocked-empty">
            <strong>{formatPreviewUnbuiltMessage(previewBlockedPlate.blockingErrorCount)}</strong>
            {previewBlockedPlate.canNavigateToError ? (
              <button type="button" data-testid="preview-blocked-empty-first-error" onClick={handleNavigateToFirstError}>
                К первой ошибке
              </button>
            ) : null}
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
          onCaptureEntitySource={captureEntitySource}
          onApplyReturnedIntent={applyEntityReturnedIntent}
          onCreateView={canRefactorEntity ? handleCreateEntityView : undefined}
          onRequestRename={canRefactorEntity ? handleRequestRenameEntity : undefined}
          onRequestDelete={canRefactorEntity ? handleRequestDeleteEntity : undefined}
          onBeginAssetPick={canRefactorEntity ? beginAssetPick : undefined}
          onUploadAsset={canRefactorEntity ? handleUploadAsset : undefined}
        />
        {entityRefactorDialog?.kind === "delete" ? (
          <DeleteEntityDialog
            entityLabel={entityRefactorDialog.entityLabel}
            facets={entityRefactorDialog.facets}
            incomingReferences={entityRefactorDialog.incomingReferences}
            retargetOptions={entityRefactorDialog.retargetOptions}
            onCancel={closeEntityRefactorDialog}
            onDeleteAndClean={() => void confirmDeleteEntity("clean")}
            onRetarget={(retargetTo) => void confirmDeleteEntity("retarget", retargetTo)}
          />
        ) : entityRefactorDialog?.kind === "rename" ? (
          <RenameEntityIdDialog
            entityLabel={entityRefactorDialog.entityLabel}
            currentId={entityRefactorDialog.currentId}
            suggestedId={entityRefactorDialog.suggestedId}
            error={entityRefactorDialog.error}
            onCancel={closeEntityRefactorDialog}
            onConfirm={(newId) => void confirmRenameEntityId(newId)}
          />
        ) : null}
      </div>
    </section>
  );
}
