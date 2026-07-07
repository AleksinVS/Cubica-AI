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

import { JsonTreeView } from "@/components/json-tree-view";
import { EditorCopilotChatPanel } from "@/components/editor-agent-ui";

import { AiChatSidebarPanel } from "./ai-chat-sidebar-panel.tsx";
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
    handleSidebarResizeStart
  } = controller;

  return (
    <aside className="left-sidebar-panel" aria-label={leftSidebarPanel === "timeline" ? "Timeline" : leftSidebarPanel === "chat" ? "AI chat" : "Manifest navigation"}>
      {leftSidebarPanel === "tree" ? (
        <>
          <div className="panel-heading manifest-heading">
            <strong>Manifest</strong>
            <div className="surface-tabs" role="tablist" aria-label="Manifest views">
              <button
                type="button"
                className={surfaceMode === "tree" ? "is-active" : ""}
                role="tab"
                aria-selected={surfaceMode === "tree"}
                onClick={() => setSurfaceMode("tree")}
              >
                Tree
              </button>
              <button
                type="button"
                className={surfaceMode === "graph" ? "is-active" : ""}
                role="tab"
                aria-selected={surfaceMode === "graph"}
                onClick={() => setSurfaceMode("graph")}
              >
                Graph
              </button>
              <button
                type="button"
                className={surfaceMode === "entities" ? "is-active" : ""}
                role="tab"
                aria-selected={surfaceMode === "entities"}
                onClick={() => setSurfaceMode("entities")}
              >
                Entities
              </button>
            </div>
            <button type="button" onClick={() => setLeftSidebarPanel(undefined)} aria-label="Collapse manifest panel">
              Collapse
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
      ) : (
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
      )}
      <div
        className="sidebar-resize-handle sidebar-resize-handle-left"
        data-testid="left-sidebar-resize-handle"
        role="separator"
        aria-label="Resize left sidebar"
        aria-orientation="vertical"
        onPointerDown={(event) => handleSidebarResizeStart("left", event)}
      />
    </aside>
  );
}
