/**
 * Bottom status/diagnostics strip.
 *
 * Shows the sync label, status message, preview/viewport/workflow/rollback state,
 * graph budget counters, the plugin diagnostics journal, the prototype-audit
 * notice, the AI diff summary, and the list of blocking diagnostics.
 * Presentational: everything is read from the {@link EditorWorkspaceController};
 * every user-facing caption comes from the Russian chrome locale
 * (@/lib/locale, TSK-20260708).
 */
import { editorRu as t } from "@/lib/locale";
import { getVisibleGraphBudgetLabel } from "@/lib/editor-web-adapter";
import { PluginDiagnosticsJournal } from "@/components/plugin-diagnostics-journal";
import { PrototypeAuditNotice } from "@/components/prototype-audit-notice";
import { PreviewFreshnessIndicator } from "@/components/workspace/preview-freshness-indicator";
import { formatRelativeVersionTime } from "@/components/workspace/history-sidebar-panel";

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
    previewViewportOrientation,
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
    setLeftSidebarPanel,
    latestSavedAt,
    unsavedFileCount
  } = controller;
  // Compact «Проверки» counter (mockup zone 7): errors + warnings; clicking it
  // opens the Checks tab (§9.6 "счётчики в статус-баре открывают Проверки").
  const checkActionable = checkCounts.error + checkCounts.warning;

  return (
    <footer className="diagnostics-strip" aria-label={t.statusBar.diagnosticsAria}>
      <div className="status-strip" aria-label={t.statusBar.statusAria}>
        <strong>{t.statusBar.status}</strong>
        <span className={hasBlockingDiagnostics || saveState === "error" || saveState === "conflict" ? "status-invalid" : "status-valid"}>
          {syncLabel}
        </span>
        <span>{statusMessage}</span>
        {latestSavedAt !== undefined ? (
          <span>{t.statusBar.savedAndDirtyFiles(formatRelativeVersionTime(latestSavedAt), unsavedFileCount)}</span>
        ) : null}
        <span>{t.statusBar.mode}: {previewModeLabel}{altPlayActive || previewPointerPlayMode ? t.statusBar.altSuffix : ""}</span>
        <span>{t.statusBar.viewport}: {t.statusBar.viewportValue(previewViewportMode, previewViewportOrientation)}</span>
        <span>{previewUrl === null ? t.statusBar.previewNotPrepared : t.statusBar.previewSelectable(previewEntities.length)}</span>
        {/* Preview freshness on the playthrough axis (editor-preview-first-ux
            §9.6; design-spec §4 codes preview-stale / preview-blocked). */}
        <PreviewFreshnessIndicator descriptor={previewFreshnessDescriptor} />
        <span>{t.statusBar.traceEvents(previewTrace.events.length)}</span>
        <span>{t.statusBar.workflow}: {t.statusBar.workflowLabel[workflowState] ?? workflowState}</span>
        <span>{t.statusBar.rollback}: {t.statusBar.rollbackLabel[previewRollbackState] ?? previewRollbackState}</span>
        <button
          type="button"
          className={`status-checks ${checkActionable > 0 ? "status-checks-active" : ""}`}
          data-testid="status-checks-counter"
          onClick={() => setLeftSidebarPanel("checks")}
          title={t.statusBar.openChecks}
        >
          {t.statusBar.checks}: {checkActionable > 0 ? `${checkActionable}` : t.statusBar.checksOk}
        </button>
        <span>{t.statusBar.selection}: {selectedNode?.semanticTitle ?? t.statusBar.none}</span>
        <span>{getVisibleGraphBudgetLabel(viewModel)}</span>
        <span>{t.statusBar.edges(flowEdges.length)}</span>
        {nonVisualEntityCounts.map((item) => (
          <span key={item.role}>
            {item.role}: {item.count}
          </span>
        ))}
      </div>
      <div className="diagnostics-items">
        <strong>{t.statusBar.diagnostics}</strong>
      <PluginDiagnosticsJournal diagnostics={pluginDiagnostics} onSelectDiagnostic={handleDiagnosticClick} />
      <PrototypeAuditNotice
        notice={prototypeAuditSnoozed ? null : prototypeAuditNotice}
        onSnooze={() => setPrototypeAuditSnoozed(true)}
      />
      {aiDiffSummary.length > 0 ? (
        <span className="ai-diff-summary" title={aiDiffSummary.map((item) => item.description).join("\n")}>
          ИИ {t.statusBar.aiStateLabel[aiApplyState] ?? aiApplyState}: {aiDiffSummary.slice(0, 2).map((item) => humanizeDiffSummaryItem(item, viewModel.fullNodes)).join("; ")}
          {aiDiffSummary.length > 2 ? t.statusBar.andMore(aiDiffSummary.length - 2) : ""}
        </span>
      ) : null}
      {viewModel.diagnostics.length === 0 ? (
        <span className="diagnostic diagnostic-info">{t.statusBar.noBlockingDiagnostics}</span>
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
