/**
 * Bottom status/diagnostics strip.
 *
 * Shows the sync label, status message, preview/viewport/workflow/rollback state,
 * graph budget counters, the plugin diagnostics journal, the prototype-audit
 * notice, the AI diff summary, and the list of blocking diagnostics.
 * Presentational: everything is read from the {@link EditorWorkspaceController}.
 */
import { getVisibleGraphBudgetLabel } from "@/lib/editor-web-adapter";
import { PluginDiagnosticsJournal } from "@/components/plugin-diagnostics-journal";
import { PrototypeAuditNotice } from "@/components/prototype-audit-notice";
import { PreviewFreshnessIndicator } from "@/components/workspace/preview-freshness-indicator";

import { humanizeDiffSummaryItem } from "./workspace-helpers.ts";
import type { EditorWorkspaceController } from "./use-editor-workspace.ts";

export function WorkspaceStatusBar({ controller }: { controller: EditorWorkspaceController }) {
  const {
    hasBlockingDiagnostics,
    saveState,
    syncLabel,
    statusMessage,
    previewModeLabel,
    altPlayActive,
    previewPointerPlayMode,
    previewViewportMode,
    previewUrl,
    previewFreshnessDescriptor,
    previewEntities,
    previewTrace,
    workflowState,
    previewRollbackState,
    selectedNode,
    viewModel,
    flowEdges,
    nonVisualEntityCounts,
    pluginDiagnostics,
    handleDiagnosticClick,
    prototypeAuditSnoozed,
    prototypeAuditNotice,
    setPrototypeAuditSnoozed,
    aiDiffSummary,
    aiApplyState,
    checkCounts,
    setLeftSidebarPanel
  } = controller;
  // Compact «Проверки» counter (mockup zone 7): errors + warnings; clicking it
  // opens the Checks tab (§9.6 "счётчики в статус-баре открывают Проверки").
  const checkActionable = checkCounts.error + checkCounts.warning;

  return (
    <footer className="diagnostics-strip" aria-label="Diagnostics">
      <div className="status-strip" aria-label="Editor status">
        <strong>Status</strong>
        <span className={hasBlockingDiagnostics || saveState === "error" || saveState === "conflict" ? "status-invalid" : "status-valid"}>
          {syncLabel}
        </span>
        <span>{statusMessage}</span>
        <span>Mode: {previewModeLabel}{altPlayActive || previewPointerPlayMode ? " (Alt)" : ""}</span>
        <span>Viewport: {previewViewportMode}</span>
        <span>{previewUrl === null ? "Preview: not prepared" : `Preview: ${previewEntities.length} selectable`}</span>
        {/* Preview freshness on the playthrough axis (editor-preview-first-ux
            §9.6; design-spec §4 codes preview-stale / preview-blocked). */}
        <PreviewFreshnessIndicator descriptor={previewFreshnessDescriptor} />
        <span>{previewTrace.events.length} trace events</span>
        <span>Workflow: {workflowState}</span>
        <span>Rollback: {previewRollbackState}</span>
        <button
          type="button"
          className={`status-checks ${checkActionable > 0 ? "status-checks-active" : ""}`}
          data-testid="status-checks-counter"
          onClick={() => setLeftSidebarPanel("checks")}
          title="Открыть «Проверки»"
        >
          Проверки: {checkActionable > 0 ? `${checkActionable}` : "ок"}
        </button>
        <span>Selection: {selectedNode?.semanticTitle ?? "none"}</span>
        <span>{getVisibleGraphBudgetLabel(viewModel)}</span>
        <span>{flowEdges.length} edges</span>
        {nonVisualEntityCounts.map((item) => (
          <span key={item.role}>
            {item.role}: {item.count}
          </span>
        ))}
      </div>
      <div className="diagnostics-items">
        <strong>Diagnostics</strong>
      <PluginDiagnosticsJournal diagnostics={pluginDiagnostics} onSelectDiagnostic={handleDiagnosticClick} />
      <PrototypeAuditNotice
        notice={prototypeAuditSnoozed ? null : prototypeAuditNotice}
        onSnooze={() => setPrototypeAuditSnoozed(true)}
      />
      {aiDiffSummary.length > 0 ? (
        <span className="ai-diff-summary" title={aiDiffSummary.map((item) => item.description).join("\n")}>
          AI {aiApplyState}: {aiDiffSummary.slice(0, 2).map((item) => humanizeDiffSummaryItem(item, viewModel.fullNodes)).join("; ")}
          {aiDiffSummary.length > 2 ? `; +${aiDiffSummary.length - 2} more` : ""}
        </span>
      ) : null}
      {viewModel.diagnostics.length === 0 ? (
        <span className="diagnostic diagnostic-info">No blocking diagnostics</span>
      ) : (
        viewModel.diagnostics.map((diagnostic, index) => (
          <button
            className={`diagnostic diagnostic-${diagnostic.severity}`}
            key={`${diagnostic.source}-${diagnostic.pointer}-${diagnostic.message}-${index}`}
            type="button"
            onClick={() => handleDiagnosticClick(diagnostic)}
            title={`${diagnostic.source} ${diagnostic.label}: ${diagnostic.message}`}
          >
            <span>{diagnostic.source}</span>
            <strong>{diagnostic.label}</strong>
            {diagnostic.message}
          </button>
        ))
      )}
      </div>
    </footer>
  );
}
