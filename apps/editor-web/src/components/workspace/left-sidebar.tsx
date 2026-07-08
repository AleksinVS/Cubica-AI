/**
 * Left sidebar host for the manifest, timeline, and AI chat panels.
 *
 * Depending on the active panel it renders either the manifest surface (the
 * semantic React Flow graph or the JSON tree), the {@link TimelineSidebarPanel},
 * or the copilot chat (with the {@link AiChatSidebarPanel} fallback). It also
 * hosts the drag handle that resizes the sidebar. Presentational: everything is
 * read from the {@link EditorWorkspaceController}.
 */
import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow } from "@xyflow/react";

import { editorRu as t } from "@/lib/locale";
import { JsonTreeView } from "@/components/json-tree-view";
import { EditorCopilotChatPanel } from "@/components/editor-agent-ui";

import { AiChatSidebarPanel } from "./ai-chat-sidebar-panel.tsx";
import { AssetLibraryPanel } from "./asset-library-panel.tsx";
import { ChecksSidebarPanel } from "./checks-sidebar-panel.tsx";
import { IntentQueuePanel } from "./intent-queue-panel.tsx";
import { EntityTree } from "./entity-tree.tsx";
import { edgeTypes, nodeTypes } from "./semantic-graph.tsx";
import { TimelineSidebarPanel } from "./timeline-sidebar-panel.tsx";
import type { EditorWorkspaceController } from "./use-editor-workspace.ts";

export function LeftSidebar({ controller }: { controller: EditorWorkspaceController }) {
  const {
    leftSidebarPanel,
    setLeftSidebarPanel,
    surfaceMode,
    setSurfaceMode,
    flowNodes,
    flowEdges,
    flowRef,
    onNodesChange,
    persistNodePosition,
    handleFlowNodeClick,
    activeTree,
    selectedNode,
    treeCollapsedPointers,
    setTreeCollapsedPointers,
    handleTreeSelectPointer,
    entityTreeGrouping,
    setEntityTreeGrouping,
    entityGroupingTree,
    entityTreeActiveEntityId,
    handleEntityTreeSelectEntity,
    entityCreateOptions,
    canCreateEntity,
    handleCreateEntityFromTree,
    previewTraceEntries,
    selectedPreviewTraceEvent,
    selectedPreviewTraceSnapshot,
    currentPreviewTraceEvent,
    previewRollbackState,
    setSelectedPreviewTraceSequence,
    handlePreviewRollback,
    handlePreviewResetToStart,
    handlePreviewReplayCurrent,
    canPinFixture,
    handlePinFixture,
    agentConnection,
    editorAgentSurface,
    editorAgentTools,
    previewAiIntent,
    aiApplyState,
    aiDiffSummary,
    prototypeExtractionProposal,
    runAgentPreparePrototypeChangeSetTool,
    intentQueue,
    handleCancelIntent,
    handleResolveStaleIntent,
    checkGroups,
    handleCheckNavigate,
    handleCheckQuickFix,
    handleCheckQuickFixAll,
    handleCheckFixWithAgent,
    gameAssets,
    canUploadAsset,
    handleUploadAsset,
    assetContentUrl,
    assetPickField,
    handlePickAssetForField,
    handleSidebarResizeStart
  } = controller;

  return (
    <aside
      className="left-sidebar-panel"
      aria-label={
        leftSidebarPanel === "timeline"
          ? t.activityBar.timeline
          : leftSidebarPanel === "chat"
            ? t.activityBar.aiChat
            : leftSidebarPanel === "checks"
              ? t.activityBar.checks
              : leftSidebarPanel === "assets"
                ? t.activityBar.assets
                : t.leftSidebar.manifestNavAria
      }
    >
      {leftSidebarPanel === "tree" ? (
        <>
          <div className="panel-heading manifest-heading">
            <strong>{t.leftSidebar.manifest}</strong>
            <div className="surface-tabs" role="tablist" aria-label={t.leftSidebar.viewsAria}>
              <button
                type="button"
                className={surfaceMode === "tree" ? "is-active" : ""}
                role="tab"
                aria-selected={surfaceMode === "tree"}
                onClick={() => setSurfaceMode("tree")}
              >
                {t.leftSidebar.surfaceTree}
              </button>
              <button
                type="button"
                className={surfaceMode === "graph" ? "is-active" : ""}
                role="tab"
                aria-selected={surfaceMode === "graph"}
                onClick={() => setSurfaceMode("graph")}
              >
                {t.leftSidebar.surfaceGraph}
              </button>
              <button
                type="button"
                className={surfaceMode === "entities" ? "is-active" : ""}
                role="tab"
                aria-selected={surfaceMode === "entities"}
                onClick={() => setSurfaceMode("entities")}
              >
                {t.leftSidebar.surfaceEntities}
              </button>
            </div>
            <button type="button" onClick={() => setLeftSidebarPanel(undefined)} aria-label={t.leftSidebar.collapseManifestAria}>
              {t.common.collapse}
            </button>
          </div>
          <div className="flow-surface">
            {surfaceMode === "graph" ? (
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                fitView
                fitViewOptions={{ padding: 0.18 }}
                minZoom={0.35}
                maxZoom={1.6}
                nodesDraggable
                onlyRenderVisibleElements={flowNodes.length > 40}
                onInit={(instance) => {
                  flowRef.current = instance;
                }}
                onNodesChange={onNodesChange}
                onNodeDragStop={(_, node) => void persistNodePosition(node)}
                onNodeClick={handleFlowNodeClick}
                colorMode="light"
              >
                <Background variant={BackgroundVariant.Lines} gap={28} color="#d6dde8" lineWidth={1} />
                <MiniMap pannable zoomable nodeStrokeWidth={2} maskColor="rgba(247, 249, 252, 0.7)" />
                <Controls showInteractive={false} />
              </ReactFlow>
            ) : surfaceMode === "entities" ? (
              <EntityTree
                grouping={entityTreeGrouping}
                onGroupingChange={setEntityTreeGrouping}
                tree={entityGroupingTree}
                selectedEntityId={entityTreeActiveEntityId}
                onSelectEntity={handleEntityTreeSelectEntity}
                canCreate={canCreateEntity}
                typeOptions={entityCreateOptions}
                onCreate={(request) => void handleCreateEntityFromTree(request)}
              />
            ) : (
              <JsonTreeView
                tree={activeTree}
                selectedPointer={selectedNode?.pointer ?? ""}
                collapsedPointers={treeCollapsedPointers}
                onCollapsedPointersChange={setTreeCollapsedPointers}
                onSelectPointer={(pointer) => handleTreeSelectPointer(pointer)}
              />
            )}
          </div>
        </>
      ) : leftSidebarPanel === "timeline" ? (
        <TimelineSidebarPanel
          traceEntries={previewTraceEntries}
          selectedTraceEvent={selectedPreviewTraceEvent}
          selectedTraceSnapshot={selectedPreviewTraceSnapshot}
          selectedTraceSequence={selectedPreviewTraceEvent?.sequence}
          currentTraceSequence={currentPreviewTraceEvent?.sequence}
          rollbackState={previewRollbackState}
          onCollapse={() => setLeftSidebarPanel(undefined)}
          onSelectTraceSequence={setSelectedPreviewTraceSequence}
          onRestoreSelectedTrace={() => {
            if (selectedPreviewTraceEvent !== undefined) {
              void handlePreviewRollback(selectedPreviewTraceEvent.sequence);
            }
          }}
          onReset={handlePreviewResetToStart}
          onReplayCurrent={handlePreviewReplayCurrent}
          canPinFixture={canPinFixture}
          onPinFixture={handlePinFixture}
        />
      ) : leftSidebarPanel === "checks" ? (
        /* «Проверки» tab (Phase 8.1; design-spec §3.5; UX §9.6; ADR-057 §4.12):
           all diagnostics grouped by severity, with navigation and quick fixes. */
        <ChecksSidebarPanel
          groups={checkGroups}
          onNavigate={handleCheckNavigate}
          onQuickFix={handleCheckQuickFix}
          onQuickFixAll={handleCheckQuickFixAll}
          onFixWithAgent={handleCheckFixWithAgent}
          onCollapse={() => setLeftSidebarPanel(undefined)}
        />
      ) : leftSidebarPanel === "assets" ? (
        /* Asset library (Phase 9.2; design-spec §3.6; UX §9.4; ADR-057 §4): the
           game's asset files with a usage counter, orphan diagnostics, search,
           type filter, and drag/upload. In pick mode it routes a chosen asset
           back to the inspector's asset-reference field. */
        <AssetLibraryPanel
          assets={gameAssets}
          canUpload={canUploadAsset}
          onUpload={handleUploadAsset}
          assetContentUrl={assetContentUrl}
          onCollapse={() => setLeftSidebarPanel(undefined)}
          pickForLabel={assetPickField?.label}
          onPickAsset={handlePickAssetForField}
        />
      ) : (
        <>
          {/* Agent intent queue (ADR-057 §4.11; UX §9.5) — always visible in the
              session "Журнал"/chat surface, above whichever chat variant renders. */}
          <IntentQueuePanel
            intents={intentQueue}
            onCancelIntent={handleCancelIntent}
            onResolveStaleIntent={handleResolveStaleIntent}
          />
          <EditorCopilotChatPanel
            enabled={agentConnection.copilotReady}
            connection={agentConnection}
            onCollapse={() => setLeftSidebarPanel(undefined)}
            surface={editorAgentSurface}
            tools={editorAgentTools}
            fallback={
              <AiChatSidebarPanel
                proposedIntent={previewAiIntent}
                aiApplyState={aiApplyState}
                aiDiffSummary={aiDiffSummary}
                prototypeExtractionProposal={prototypeExtractionProposal}
                selectedNodeTitle={selectedNode?.semanticTitle}
                onUsePrototypeProposal={() => {
                  void runAgentPreparePrototypeChangeSetTool();
                }}
                onCollapse={() => setLeftSidebarPanel(undefined)}
              />
            }
          />
        </>
      )}
      <div
        className="sidebar-resize-handle sidebar-resize-handle-left"
        data-testid="left-sidebar-resize-handle"
        role="separator"
        aria-label={t.leftSidebar.resizeAria}
        aria-orientation="vertical"
        onPointerDown={(event) => handleSidebarResizeStart("left", event)}
      />
    </aside>
  );
}
