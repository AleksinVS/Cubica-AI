/**
 * Preview stage: the embedded player iframe and inspect overlay.
 *
 * When a preview is prepared it renders the player in an iframe with the
 * {@link PreviewSelectionOverlay} on top (for Inspect selection / region prompts);
 * otherwise it shows the empty state with a "Prepare preview" button.
 * Presentational: all state and handlers come from the {@link EditorWorkspaceController}.
 */
import { isPlainJsonObject, readJsonPointer, type JsonObject, type PreviewPoint, type PreviewRect } from "@cubica/editor-engine";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { editorRu as t } from "@/lib/locale";
import { PreviewSelectionOverlay } from "@/components/preview-selection-overlay";
import { EntityInspector } from "@/components/workspace/entity-inspector";
import { collectKnownViewCreationChannels } from "@/components/workspace/checks-helpers";
import { DeleteEntityDialog, RenameEntityIdDialog } from "@/components/workspace/entity-refactor-dialog";
import { PreviewModeBanner } from "@/components/workspace/preview-mode-banner";
import { TelegramStructuralViewer, type TelegramStructuralSelection } from "@/components/workspace/telegram-structural-viewer";
import { formatPreviewUnbuiltMessage, toRepositoryAuthoringFilePath } from "@/components/workspace/workspace-helpers";
import { projectTelegramAuthoringManifest } from "@/lib/telegram-structural-projection";
import { projectEditorWireframe, type EditorWireframeNode } from "@/lib/editor-wireframe-projection";
import { EditorWireframe, type EditorWireframeSelection } from "./editor-wireframe";
import { MvpElementEditor, type MvpElementDraft } from "./mvp-element-editor";
import { mvpSourceEntity } from "./mvp-authoring-actions";
import { buildMvpGeometryChangeSet, geometrySupport, type MvpElementSource } from "./mvp-element-operations";

import type { EditorWorkspaceController } from "./use-editor-workspace.ts";

export function PreviewStage({ controller, onStartDrawing, onPageSourceChange, requestedSource }: {
  readonly controller: EditorWorkspaceController;
  readonly onStartDrawing?: (rect: PreviewRect) => void;
  readonly onPageSourceChange?: (source: { filePath: string; pointer: string } | undefined) => void;
  readonly requestedSource?: { filePath: string; pointer: string; requestId: number };
}) {
  const {
    mvp,
    editorMode,
    currentPreviewTraceEvent,
    canApplyEditsToPreview,
    handleApplyEditsToPreview,
    stateFixtures,
    selectedFixtureId,
    handleSelectFixture,
    previewViewportMode,
    previewViewportOrientation,
    previewChannel,
    previewUrl,
    previewIframeRef,
    handlePreviewFrameLoad,
    effectivePreviewInspectMode,
    previewEntities,
    selectedPreviewEntityId,
    previewPointSelectionMode,
    previewPromptContext,
    previewAiIntent,
    previewUnresolvedEntityCount,
    handlePreviewEntitySelect,
    handleChannelEntitySelect,
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
    applyMvpEntityReturnedIntent,
    directMvpMutation,
    submitMvpElementPrompt,
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
    handleNavigateToFirstError,
    telegramMissingViewCallout
  } = controller;

  // Refactor affordances only when there is a worktree to persist sibling facets
  // into (a repository session); the embedded fallback hides them, mirroring the
  // «+» create menu's `canCreateEntity` gate.
  const canRefactorEntity = currentDocument.source === "repository";
  const requestedViewChannel = previewChannel === "telegram" ? "telegram" : activeChannel;
  const canCreateViewInRequestedChannel =
    requestedViewChannel !== undefined &&
    collectKnownViewCreationChannels(viewModel.entityProjectionDocuments).includes(requestedViewChannel);

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

  // The ordinary Telegram viewer reads the sibling UI authoring document. It
  // must never fall back to the generative CubicaSurface projection: those are
  // different sources of truth for different product modes.
  const telegramDocument = useMemo(
    () => viewModel.entityProjectionDocuments.find((document) => document.documentKind === "ui" && document.channel === "telegram"),
    [viewModel.entityProjectionDocuments]
  );
  const telegramProjection = useMemo(
    () => telegramDocument?.json === undefined ? null : projectTelegramAuthoringManifest(telegramDocument.json, telegramDocument.filePath),
    [telegramDocument]
  );

  const webDocument = useMemo(
    () => viewModel.entityProjectionDocuments.find((document) => document.documentKind === "ui" && document.channel === "web"),
    [viewModel.entityProjectionDocuments]
  );
  const wireframeProjection = useMemo(
    () => !mvp && previewUrl === null && webDocument?.json !== undefined
      ? projectEditorWireframe(webDocument.json, webDocument.filePath)
      : null,
    [mvp, previewUrl, webDocument]
  );

  const resolveSourceEntityId = useCallback((sourceFilePath: string, sourcePointer: string): string | undefined => {
    let pointer = sourcePointer;
    while (pointer !== "") {
      const entity = viewModel.editorEntityProjection.entitiesBySourcePointer
        .get(`${sourceFilePath}#${pointer}`)?.[0];
      if (entity !== undefined) return entity.entityId;
      pointer = pointer.slice(0, pointer.lastIndexOf("/"));
    }
    return undefined;
  }, [viewModel.editorEntityProjection.entitiesBySourcePointer]);

  const selectedTelegramSourcePointer = telegramProjection?.messages.flatMap((message) => [message, ...message.actions])
    .find((item) => resolveSourceEntityId(item.sourceFilePath, item.sourcePointer) === selectedPreviewEntityId)
    ?.sourcePointer;

  const [wireframeSelection, setWireframeSelection] = useState<EditorWireframeSelection | null>(null);
  const promptDrafts = useMemo(() => new Map<string, MvpElementDraft>(), [currentDocument.gameId]);
  const [wireframeScreenId, setWireframeScreenId] = useState<string>();
  const [scopeSelection, setScopeSelection] = useState<{ filePath: string; pointer: string; point: PreviewPoint } | null>(null);
  const [prototypeSelection, setPrototypeSelection] = useState<{
    instance: MvpElementSource;
    source: MvpElementSource;
    name: string;
    affectedCount: number;
    overriddenCount?: number;
    point?: PreviewPoint;
  } | null>(null);
  const [prototypeNotice, setPrototypeNotice] = useState("");
  const prototypeRequest = useRef(0);
  const openingPrototypeRequest = useRef<number | null>(null);
  const selectionIdentity = `${currentDocument.gameId}#${selectedPreviewEntityId ?? ""}#${requestedSource?.filePath ?? ""}#${requestedSource?.pointer ?? ""}`;
  const selectionIdentityRef = useRef(selectionIdentity);
  selectionIdentityRef.current = selectionIdentity;
  useEffect(() => {
    const invalidation = ++prototypeRequest.current;
    if (openingPrototypeRequest.current !== null || prototypeSelection !== null) {
      openingPrototypeRequest.current = null;
      setPrototypeNotice("Возвращаем экземпляр…");
      void controller.clearMvpPrototypePreview().then(result => {
        if (invalidation === prototypeRequest.current) setPrototypeNotice(result.ok ? "Показан экземпляр." : result.message);
      });
      setPrototypeSelection(null);
    }
  }, [selectionIdentity]);
  async function returnToInstance() {
    prototypeRequest.current += 1;
    openingPrototypeRequest.current = null;
    const result = await controller.clearMvpPrototypePreview();
    if (result && !result.ok) { setPrototypeNotice(result.message); return; }
    setPrototypeSelection(null);
    setPrototypeNotice("");
  }
  useEffect(() => {
    prototypeRequest.current += 1;
    openingPrototypeRequest.current = null;
    setPrototypeSelection(null);
    setPrototypeNotice("");
  }, [currentDocument.gameId, previewUrl]);
  useEffect(() => {
    if (prototypeSelection !== null && controller.mvpPrototypePreviewIdentity === null) {
      setPrototypeSelection(null);
      setPrototypeNotice("Предпросмотр обновлён. Показан экземпляр.");
    }
  }, [controller.mvpPrototypePreviewIdentity, prototypeSelection]);
  useEffect(() => { setScopeSelection(null); setWireframeSelection(null); setWireframeScreenId(undefined); }, [currentDocument.gameId]);
  useEffect(() => {
    if (requestedSource === undefined) return;
    setScopeSelection({ filePath: requestedSource.filePath, pointer: requestedSource.pointer, point: { x: 64, y: 64 } });
    setSelectedPreviewEntityId(undefined);
    setPreviewPromptContext(null);
    const screenPointer = requestedSource.pointer.match(/^\/root\/screens\/[^/]+/u)?.[0];
    const document = viewModel.entityProjectionDocuments.find(item => item.filePath === requestedSource.filePath);
    const screen = document?.json === undefined || screenPointer === undefined ? undefined : readJsonPointer(document.json, screenPointer);
    if (isPlainJsonObject(screen) && typeof screen.id === "string") setWireframeScreenId(screen.id);
  }, [requestedSource]);
  const selectedWireframeSourcePointer = useMemo(() => {
    // Incomplete nodes still receive visual selection even before the authoring
    // projection can resolve a writable entity. Keep their exact source point.
    if (wireframeSelection?.sourceFilePath === webDocument?.filePath && wireframeSelection !== null &&
      resolveSourceEntityId(wireframeSelection.sourceFilePath, wireframeSelection.sourcePointer) === selectedPreviewEntityId) {
      return wireframeSelection.sourcePointer;
    }
    if (selectedPreviewEntityId === undefined || wireframeProjection === null) return undefined;
    const findSelected = (nodes: readonly EditorWireframeNode[]): string | undefined => {
      for (const node of nodes) {
        if (resolveSourceEntityId(node.sourceFilePath, node.sourcePointer) === selectedPreviewEntityId) return node.sourcePointer;
        const child = findSelected(node.children);
        if (child !== undefined) return child;
      }
      return undefined;
    };
    return findSelected(wireframeProjection.screens.flatMap(screen => screen.nodes));
  }, [selectedPreviewEntityId, wireframeProjection, resolveSourceEntityId, wireframeSelection, webDocument?.filePath]);

  const mvpPreviewEntities = useMemo(() => !mvp ? previewEntities : previewEntities.map((candidate) => {
    const sourceFile = candidate.metadata?.sourceFile;
    const filePath = typeof sourceFile === "string" ? toRepositoryAuthoringFilePath(sourceFile, currentDocument.gameId) : undefined;
    const document = viewModel.entityProjectionDocuments.find((item) => item.filePath === filePath);
    const value = document?.json === undefined ? undefined : readJsonPointer(document.json, candidate.authoringPointer);
    const sourceObject = typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as JsonObject : undefined;
    const label = typeof sourceObject?._label === "string" ? sourceObject._label : candidate.label;
    return label === candidate.label ? candidate : { ...candidate, label };
  }), [mvp, previewEntities, currentDocument.gameId, viewModel.entityProjectionDocuments]);
  const selectedPreviewDescriptor = mvpPreviewEntities.find((candidate) => candidate.entityId === selectedPreviewEntityId);
  const selectedProjectionEntity = selectedPreviewEntityId === undefined ? undefined
    : viewModel.editorEntityProjection.entityById.get(selectedPreviewEntityId);
  const matchingWireframeSelection = wireframeSelection !== null &&
    (selectedPreviewEntityId === undefined || resolveSourceEntityId(wireframeSelection.sourceFilePath, wireframeSelection.sourcePointer) === selectedPreviewEntityId)
    ? wireframeSelection : null;
  const selectedSourceFile = selectedPreviewDescriptor?.metadata?.sourceFile;
  const selectedFilePath = prototypeSelection?.source.filePath ?? scopeSelection?.filePath ?? (previewUrl !== null
    ? (typeof selectedSourceFile === "string" ? toRepositoryAuthoringFilePath(selectedSourceFile, currentDocument.gameId) : undefined)
      ?? selectedProjectionEntity?.primarySource.filePath
    : matchingWireframeSelection?.sourceFilePath ?? selectedProjectionEntity?.primarySource.filePath);
  const selectedSourcePointer = prototypeSelection?.source.pointer ?? scopeSelection?.pointer ?? (previewUrl !== null
    ? selectedPreviewDescriptor?.authoringPointer ?? selectedProjectionEntity?.primarySource.pointer
    : matchingWireframeSelection?.sourcePointer ?? selectedProjectionEntity?.primarySource.pointer);
  const selectedDocument = viewModel.entityProjectionDocuments.find((document) => document.filePath === selectedFilePath);
  const selectedSourceValue = selectedDocument?.json === undefined || selectedSourcePointer === undefined
    ? undefined : readJsonPointer(selectedDocument.json, selectedSourcePointer);
  const mvpSource: MvpElementSource | undefined = typeof selectedSourceValue === "object" && selectedSourceValue !== null && !Array.isArray(selectedSourceValue)
    && selectedFilePath !== undefined && selectedSourcePointer !== undefined
    ? { filePath: selectedFilePath, pointer: selectedSourcePointer, value: selectedSourceValue as JsonObject }
    : undefined;
  const selectedSourceEntityId = selectedFilePath !== undefined && selectedSourcePointer !== undefined
    ? resolveSourceEntityId(selectedFilePath, selectedSourcePointer) : undefined;
  const mvpEntity = (selectedSourceEntityId === undefined ? undefined : viewModel.editorEntityProjection.entityById.get(selectedSourceEntityId)) ??
    (mvpSource === undefined || (selectedDocument?.documentKind !== "game" && selectedDocument?.documentKind !== "ui") ? undefined : mvpSourceEntity(mvpSource, selectedDocument.documentKind));
  const prototypeContext = mvpSource === undefined || prototypeSelection !== null ? undefined : controller.mvpPrototypeContext(mvpSource);
  const effectiveStyle = mvpSource === undefined ? undefined : controller.mvpEffectiveStyle(mvpSource);
  const editingMode = prototypeSelection === null ? "instance" : "prototype";
  const semanticCapture = mvpSource === undefined ? undefined : controller.captureMvpElementSource(mvpSource, editingMode);
  const mvpPanelLabel = typeof mvpSource?.value._label === "string" ? mvpSource.value._label :
    selectedPreviewDescriptor?.label ?? selectedProjectionEntity?.label ?? matchingWireframeSelection?.sourcePointer.split("/").at(-1) ?? "Элемент";

  const selectedPagePointer = selectedSourcePointer?.match(/^\/root\/screens\/[^/]+/u)?.[0];
  const visiblePagePointer = previewUrl === null ? undefined : mvpPreviewEntities.find(item => item.visible && /^\/root\/screens\/[^/]+/u.test(item.authoringPointer))?.authoringPointer.match(/^\/root\/screens\/[^/]+/u)?.[0];
  const webRoot = webDocument?.json === undefined ? undefined : readJsonPointer(webDocument.json, "/root");
  const screens = isPlainJsonObject(webRoot) ? webRoot.screens : undefined;
  const screenEntries = Array.isArray(screens) ? screens.map((value, index) => [String(index), value] as const)
    : screens !== null && typeof screens === "object" ? Object.entries(screens) : [];
  const entryId = wireframeScreenId ?? (isPlainJsonObject(webRoot) ? webRoot.entry_point : undefined);
  const currentScreen = screenEntries.find(([key, value]) => key === entryId || value !== null && typeof value === "object" && !Array.isArray(value) && value.id === entryId) ?? screenEntries[0];
  const pagePointer = selectedPagePointer ?? visiblePagePointer ?? (currentScreen === undefined ? undefined : `/root/screens/${currentScreen[0].replace(/~/gu, "~0").replace(/\//gu, "~1")}`);
  useEffect(() => { onPageSourceChange?.(webDocument === undefined || pagePointer === undefined ? undefined : { filePath: webDocument.filePath, pointer: pagePointer }); }, [webDocument?.filePath, pagePointer, onPageSourceChange]);

  function selectScope(scope: "game" | "page", point: PreviewPoint) {
    const document = scope === "game" ? viewModel.entityProjectionDocuments.find((item) => item.documentKind === "game") : webDocument;
    const pointer = scope === "game" ? "/root" : pagePointer;
    if (document === undefined || pointer === undefined) return;
    setSelectedPreviewEntityId(undefined);
    setPreviewPromptContext(null);
    setWireframeSelection(null);
    setScopeSelection({ filePath: document.filePath, pointer, point });
  }

  function selectPreviewEntity(...args: Parameters<typeof handlePreviewEntitySelect>) {
    setScopeSelection(null);
    handlePreviewEntitySelect(...args);
  }

  function handleTelegramSelection(selection: TelegramStructuralSelection) {
    if (telegramDocument === undefined) return;
    // Buttons are often facets of their containing component rather than a
    // standalone entity. Walk towards the document root until the entity
    // projection provides the nearest stable authoring owner.
    const entityId = resolveSourceEntityId(selection.sourceFilePath, selection.sourcePointer);
    if (entityId !== undefined) handleChannelEntitySelect(entityId);
  }

  return (
    <section className="preview-stage" aria-label={t.previewStage.stageAria}>
      <div
        className={`preview-frame-shell preview-viewport-${previewViewportMode} preview-orientation-${previewViewportOrientation}`}
        data-viewport-orientation={previewViewportOrientation}
      >
        {previewChannel === "telegram" ? (
          <div className="preview-viewport-canvas">
            <TelegramStructuralViewer
              projection={telegramProjection}
              selectedSourcePointer={selectedTelegramSourcePointer}
              onSelect={handleTelegramSelection}
              resolveEditorEntityId={resolveSourceEntityId}
              inspectMode={effectivePreviewInspectMode}
              missingViewCallout={telegramMissingViewCallout}
            />
          </div>
        ) : previewUrl !== null ? (
          <div className="preview-viewport-canvas">
            {/* Mode plate + apply state (design-spec §3.3, mockup zone 3). */}
            {!mvp ? <PreviewModeBanner
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
            /> : null}
            <iframe
              key={previewUrl}
              ref={previewIframeRef}
              title={t.previewStage.iframeTitle}
              src={previewUrl}
              onLoad={handlePreviewFrameLoad}
              allow="fullscreen"
              // Scripts render the player, while its original origin is needed for
              // the editor's strict message-origin check in use-editor-workspace.
              sandbox="allow-scripts allow-same-origin"
            />
            <PreviewSelectionOverlay
              mvp={mvp}
              geometryUnsupportedReason={geometrySupport(mvpSource, effectiveStyle)}
              onGeometryCommit={async (entity, gesture) => {
                if (mvpSource === undefined || entity.entityId !== selectedPreviewEntityId) return false;
                const changeSet = buildMvpGeometryChangeSet(mvpSource, entity.bounds, gesture, effectiveStyle);
                if (changeSet === undefined || !await directMvpMutation(changeSet)) return false;
                return controller.waitForLatestPreviewBuild();
              }}
              onRegionRectChange={(rect) => {
                if (previewPromptContext?.kind === "region") void handlePreviewRegionSelect(previewPromptContext.entities, rect, previewPromptContext.point);
              }}
              onStartDrawing={onStartDrawing}
              onSelectScope={selectScope}
              disabled={prototypeSelection !== null || !effectivePreviewInspectMode || (mvp && (controller.aiApplyState === "applying" || controller.aiApplyState === "planning"))}
              entities={mvpPreviewEntities}
              selectedEntityId={selectedPreviewEntityId}
              pointSelectionEnabled={previewPointSelectionMode}
              promptContext={previewPromptContext}
              proposedIntent={previewAiIntent}
              unresolvedCount={previewUnresolvedEntityCount}
              onSelectEntity={selectPreviewEntity}
              onSelectRegion={handlePreviewRegionSelect}
              onClearContext={() => {
                setSelectedPreviewEntityId(undefined);
                setPreviewPromptContext(null);
                setPreviewAiIntent(null);
                setScopeSelection(null);
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
            {prototypeSelection !== null ? <div aria-label="Окружение прототипа заблокировано" style={{ position: "absolute", inset: 0, zIndex: 11 }} /> : null}
          </div>
        ) : !mvp && wireframeProjection !== null ? (
          <div className="preview-wireframe-host">
            {previewBlockedPlate !== null ? (
              <p role="status">{formatPreviewUnbuiltMessage(previewBlockedPlate.blockingErrorCount)}</p>
            ) : null}
            <EditorWireframe
              projection={wireframeProjection}
              selectedScreenId={wireframeScreenId}
              onScreenChange={setWireframeScreenId}
              selectedSourcePointer={selectedWireframeSourcePointer}
              onSelect={(selection) => {
                setScopeSelection(null);
                setWireframeSelection(selection);
                const entityId = resolveSourceEntityId(selection.sourceFilePath, selection.sourcePointer);
                if (entityId !== undefined) handleChannelEntitySelect(entityId);
                else {
                  handleInspectorClose();
                  setSelectedPreviewEntityId(undefined);
                }
              }}
            />
            <button
              type="button"
              onClick={handlePreview}
              disabled={currentDocument.source !== "repository" || isDirty || hasLocalSchemaBlockingDiagnostics || workflowState === "compiling" || workflowState === "previewing"}
            >{t.previewStage.preparePreview}</button>
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
        ) : mvp && workflowState === "previewing" ? (
          <div className="preview-empty-state" role="status">Подготавливаем игру для редактора…</div>
        ) : (
          <div className="preview-empty-state">
            <strong>{selectedNode?.semanticTitle ?? t.previewStage.noSelection}</strong>
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
              {t.previewStage.preparePreview}
            </button>
          </div>
        )}
        {prototypeNotice ? <p role="status" className="preview-context-notice">{prototypeNotice}</p> : null}
        {mvp && (prototypeSelection !== null || scopeSelection !== null || selectedPreviewDescriptor !== undefined || matchingWireframeSelection !== null && previewUrl === null || selectedProjectionEntity !== undefined) ? (
          <div hidden={!effectivePreviewInspectMode}>
          <MvpElementEditor
            drafts={promptDrafts}
            key={`${selectedFilePath ?? "unmapped"}#${selectedSourcePointer ?? selectedPreviewEntityId ?? "unknown"}`}
            source={previewUrl === null && mvpEntity === undefined ? undefined : mvpSource}
            entity={mvpEntity}
            label={mvpPanelLabel}
            selectedLayerId={selectedPreviewDescriptor?.entityId}
            bounds={prototypeSelection === null && scopeSelection === null ? inspectorBounds : undefined}
            geometryUnsupportedReason={prototypeSelection !== null || selectedPreviewDescriptor === undefined ? undefined : geometrySupport(mvpSource, effectiveStyle)}
            layers={previewPromptContext?.kind === "entity" ? previewPromptContext.entities.map((item) => mvpPreviewEntities.find((candidate) => candidate.entityId === item.entityId) ?? item) : undefined}
            layerPoint={prototypeSelection?.point ?? scopeSelection?.point ?? (previewPromptContext?.kind === "entity" ? previewPromptContext.point : matchingWireframeSelection?.point)}
            onSelectLayer={selectPreviewEntity}
            onSelectScope={selectScope}
            onClose={() => { if (prototypeSelection !== null) { void returnToInstance(); return; } handleInspectorClose(); setSelectedPreviewEntityId(undefined); setWireframeSelection(null); setScopeSelection(null); setPreviewPromptContext(null); }}
            editingPrototype={prototypeSelection ?? undefined}
            contextKey={semanticCapture?.contextKey}
            localChildOverrides={prototypeContext?.localChildOverrides}
            onEditPrototype={prototypeContext === undefined || mvpSource === undefined ? undefined : () => {
              const instance = mvpSource;
              const request = ++prototypeRequest.current;
              const selectionAtStart = selectionIdentityRef.current;
              openingPrototypeRequest.current = request;
              setPrototypeNotice("Открываем прототип…");
              void controller.showMvpPrototypePreview(instance, prototypeContext.source).then(result => {
                if (request !== prototypeRequest.current || selectionAtStart !== selectionIdentityRef.current) return;
                openingPrototypeRequest.current = null;
                if (!result.ok) { setPrototypeNotice(result.message); return; }
                setPrototypeSelection({ ...prototypeContext, instance, point: previewPromptContext?.kind === "entity" ? previewPromptContext.point : undefined });
                setPrototypeNotice("");
              });
            }}
            onReturnToInstance={() => { void returnToInstance(); }}
            onResetOverrides={mvpSource === undefined || prototypeSelection !== null || !semanticCapture?.semantic?.properties.some(property => property.resetTarget !== undefined) ? undefined : () => controller.resetMvpInheritedProperties(mvpSource)}
            onSave={input => controller.saveMvpElementDraft({ ...input, mode: editingMode })}
            onSavePrototype={prototypeSelection === null ? controller.saveMvpPrototype : undefined}
            onCapture={(entity) => mvpSource === undefined ? captureEntitySource(entity) : controller.captureMvpElementSource(mvpSource, editingMode)}
          />
          </div>
        ) : null}
        {!mvp ? <EntityInspector
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
          onCreateView={
            canRefactorEntity && canCreateViewInRequestedChannel
              ? (entity) => handleCreateEntityView(entity, requestedViewChannel)
              : undefined
          }
          onRequestRename={canRefactorEntity ? handleRequestRenameEntity : undefined}
          onRequestDelete={canRefactorEntity ? handleRequestDeleteEntity : undefined}
          onBeginAssetPick={canRefactorEntity ? beginAssetPick : undefined}
          onUploadAsset={canRefactorEntity ? handleUploadAsset : undefined}
        /> : null}
        {!mvp && entityRefactorDialog?.kind === "delete" ? (
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
