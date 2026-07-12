"use client";

/**
 * Primary ADR-034 editor workspace (thin composition).
 *
 * The editor treats repository authoring JSON as the editable source; React Flow
 * and the preview are derived projections. All state, effects, and handlers live
 * in the `useEditorWorkspace` controller hook (`./workspace/use-editor-workspace`)
 * whose state is grouped into domain hooks. This component only wires that
 * controller into the toolbar, activity bar, sidebars, preview stage, and status
 * strip — the presentational panels each live in `./workspace/*`.
 */
import { editorRu as t } from "@/lib/locale";
import { EditorAgentRuntimeHooks } from "@/components/editor-agent-ui";

import { EditorToolbar } from "@/components/workspace/editor-toolbar";
import { LeftActivityBar } from "@/components/workspace/left-activity-bar";
import { LeftSidebar } from "@/components/workspace/left-sidebar";
import { PreviewStage } from "@/components/workspace/preview-stage";
import { RightSidebar } from "@/components/workspace/right-sidebar";
import { WorkspaceStatusBar } from "@/components/workspace/workspace-status-bar";
import { SessionRecoveryBanner } from "@/components/workspace/session-recovery-banner";
import { useEditorWorkspace } from "@/components/workspace/use-editor-workspace";

export function EditorWorkspace() {
  const controller = useEditorWorkspace();
  const {
    agentConnection,
    editorAgentContext,
    editorAgentTools,
    workspaceStyle,
    rightSidebarOpen,
    leftSidebarOpen,
    previewUrl,
    effectivePreviewInspectMode,
    sidebarResizeState,
    rightSidebarPanel
  } = controller;

  return (
    <main className="editor-shell">
      <EditorAgentRuntimeHooks enabled={agentConnection.copilotReady} context={editorAgentContext} tools={editorAgentTools} />
      <EditorToolbar controller={controller} />
      <SessionRecoveryBanner
        changedPaths={controller.sessionRecoveryPaths}
        onDismiss={controller.dismissSessionRecovery}
      />

      <section
        className={`workspace-grid ${rightSidebarOpen ? "" : "json-collapsed"} ${leftSidebarOpen ? "" : "left-sidebar-collapsed"} ${previewUrl !== null && !effectivePreviewInspectMode ? "preview-play-mode" : ""} ${sidebarResizeState !== null ? "is-resizing" : ""}`}
        style={workspaceStyle}
        aria-label={t.workspace.workspaceAria}
      >
        <LeftActivityBar controller={controller} />
        {leftSidebarOpen ? <LeftSidebar controller={controller} /> : null}
        <PreviewStage controller={controller} />
        {rightSidebarPanel !== undefined ? <RightSidebar controller={controller} /> : null}
      </section>

      <WorkspaceStatusBar controller={controller} />
    </main>
  );
}
