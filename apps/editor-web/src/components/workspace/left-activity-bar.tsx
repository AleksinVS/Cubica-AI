/**
 * Vertical activity bar that toggles the editor sidebars.
 *
 * The buttons switch the left sidebar between the manifest tree, timeline, AI
 * chat, assets and checks panels, and toggle the right-hand JSON editor.
 * Presentational: all state and toggles come from the
 * {@link EditorWorkspaceController}; labels come from the Russian chrome locale
 * (@/lib/locale, TSK-20260708).
 */
import { editorRu as t } from "@/lib/locale";

import type { EditorWorkspaceController } from "./use-editor-workspace.ts";

export function LeftActivityBar({ controller }: { controller: EditorWorkspaceController }) {
  const { leftSidebarPanel, setLeftSidebarPanel, rightSidebarPanel, setJsonPanelOpen, openJsonSidebar, selectedNode, checkCounts } =
    controller;
  // Non-info problem count for the «Проверки» activity-bar badge (§9.6): errors +
  // warnings are the actionable ones; a zero count shows no badge.
  const checkBadgeCount = checkCounts.error + checkCounts.warning;

  return (
    <nav className="left-activity-bar" aria-label={t.activityBar.sidebarsAria}>
      <button
        type="button"
        className={leftSidebarPanel === "tree" ? "is-active" : ""}
        aria-pressed={leftSidebarPanel === "tree"}
        aria-label={t.activityBar.tree}
        title={t.activityBar.tree}
        onClick={() => setLeftSidebarPanel((current) => (current === "tree" ? undefined : "tree"))}
      >
        <span aria-hidden="true">{t.activityBar.treeGlyph}</span>
      </button>
      <button
        type="button"
        className={leftSidebarPanel === "timeline" ? "is-active" : ""}
        aria-pressed={leftSidebarPanel === "timeline"}
        aria-label={t.activityBar.timeline}
        title={t.activityBar.timeline}
        onClick={() => setLeftSidebarPanel((current) => (current === "timeline" ? undefined : "timeline"))}
      >
        <span aria-hidden="true">{t.activityBar.timelineGlyph}</span>
      </button>
      <button
        type="button"
        className={leftSidebarPanel === "history" ? "is-active" : ""}
        aria-pressed={leftSidebarPanel === "history"}
        aria-label={t.activityBar.history}
        title={t.activityBar.history}
        data-testid="activity-bar-history"
        onClick={() => setLeftSidebarPanel((current) => (current === "history" ? undefined : "history"))}
      >
        <span aria-hidden="true">{t.activityBar.historyGlyph}</span>
      </button>
      <button
        type="button"
        className={leftSidebarPanel === "chat" ? "is-active" : ""}
        aria-pressed={leftSidebarPanel === "chat"}
        aria-label={t.activityBar.aiChat}
        title={t.activityBar.aiChat}
        onClick={() => setLeftSidebarPanel((current) => (current === "chat" ? undefined : "chat"))}
      >
        <span aria-hidden="true">{t.activityBar.aiChatGlyph}</span>
      </button>
      <button
        type="button"
        className={leftSidebarPanel === "assets" ? "is-active" : ""}
        aria-pressed={leftSidebarPanel === "assets"}
        aria-label={t.activityBar.assets}
        title={t.activityBar.assets}
        data-testid="activity-bar-assets"
        onClick={() => setLeftSidebarPanel((current) => (current === "assets" ? undefined : "assets"))}
      >
        <span aria-hidden="true">{t.activityBar.assetsGlyph}</span>
      </button>
      <button
        type="button"
        className={`left-activity-bar-checks ${leftSidebarPanel === "checks" ? "is-active" : ""}`}
        aria-pressed={leftSidebarPanel === "checks"}
        aria-label={t.activityBar.checks}
        title={t.activityBar.checks}
        data-testid="activity-bar-checks"
        onClick={() => setLeftSidebarPanel((current) => (current === "checks" ? undefined : "checks"))}
      >
        <span aria-hidden="true">{t.activityBar.checksGlyph}</span>
        {checkBadgeCount > 0 ? (
          <span className="left-activity-bar-badge" data-testid="activity-bar-checks-badge">
            {checkBadgeCount}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        className={rightSidebarPanel === "json" ? "is-active" : ""}
        aria-pressed={rightSidebarPanel === "json"}
        aria-label={t.activityBar.json}
        title={t.activityBar.json}
        onClick={() => {
          if (rightSidebarPanel === "json") {
            setJsonPanelOpen(false);
            return;
          }

          openJsonSidebar(selectedNode?.pointer ?? "");
        }}
      >
        <span aria-hidden="true">{t.activityBar.json}</span>
      </button>
    </nav>
  );
}
