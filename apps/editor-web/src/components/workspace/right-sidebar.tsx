/**
 * Right sidebar host for the Monaco JSON editor or the property panel.
 *
 * When the JSON panel is active it renders the Monaco authoring editor; otherwise
 * it renders the {@link PropertyPanel} for the selected node. It also hosts the
 * drag handle that resizes the right sidebar. Presentational: everything is read
 * from the {@link EditorWorkspaceController}.
 */
import Editor from "@monaco-editor/react";

import { editorRu as t } from "@/lib/locale";
import { PropertyPanel } from "./property-panel.tsx";
import { configureMonacoJson } from "./workspace-helpers.ts";
import type { MonacoApi, MonacoEditorInstance } from "./types.ts";
import type { EditorWorkspaceController } from "./use-editor-workspace.ts";

export function RightSidebar({ controller }: { controller: EditorWorkspaceController }) {
  const {
    rightSidebarPanel,
    handleSidebarResizeStart,
    hasBlockingDiagnostics,
    viewModel,
    setJsonPanelOpen,
    monacoModelUri,
    jsonText,
    schemaId,
    handleEditorMount,
    handleJsonChange,
    selectedNode,
    properties,
    handlePropertyChange,
    handlePropertyJsonChange,
    handleWritableGraphOperation,
    setPropertyPanelOpen,
    openPropertiesSidebar,
    openJsonSidebar,
    selectedValue,
    graphTargetNodes
  } = controller;

  return (
    <aside
      className={`right-sidebar-panel right-sidebar-panel-${rightSidebarPanel}`}
      aria-label={rightSidebarPanel === "json" ? t.rightSidebar.jsonEditorAria : t.rightSidebar.propertiesAria}
    >
      <div
        className="sidebar-resize-handle sidebar-resize-handle-json"
        data-testid="json-sidebar-resize-handle"
        role="separator"
        aria-label={t.rightSidebar.resizeAria}
        aria-orientation="vertical"
        onPointerDown={(event) => handleSidebarResizeStart("json", event)}
      />
      {rightSidebarPanel === "json" ? (
        <>
          <div className="panel-heading">
            <strong>{t.rightSidebar.authoringJson}</strong>
            <span>{hasBlockingDiagnostics ? t.rightSidebar.diagnosticsCount(viewModel.diagnostics.length) : t.rightSidebar.noBlockingDiagnostics}</span>
            <button type="button" onClick={() => setJsonPanelOpen(false)}>
              {t.rightSidebar.collapse}
            </button>
          </div>
          <Editor
            height="100%"
            language="json"
            path={monacoModelUri}
            value={jsonText}
            theme="light"
            beforeMount={(monaco) => configureMonacoJson(monaco as MonacoApi, monacoModelUri, schemaId)}
            onMount={(editor, monaco) => handleEditorMount(editor as MonacoEditorInstance, monaco as MonacoApi)}
            onChange={handleJsonChange}
            options={{
              automaticLayout: true,
              fontSize: 13,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              tabSize: 2,
              wordWrap: "on"
            }}
          />
        </>
      ) : (
        <PropertyPanel
          node={selectedNode}
          open
          variant="sidebar"
          properties={properties}
          diagnostics={viewModel.diagnostics}
          onChange={handlePropertyChange}
          onJsonChange={handlePropertyJsonChange}
          onGraphOperation={handleWritableGraphOperation}
          onCollapse={() => setPropertyPanelOpen(false)}
          onOpen={openPropertiesSidebar}
          onReveal={openJsonSidebar}
          selectedValue={selectedValue}
          targetNodes={graphTargetNodes}
        />
      )}
    </aside>
  );
}
