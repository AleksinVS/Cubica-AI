/**
 * Vertical activity bar that toggles the editor sidebars.
 *
 * The four buttons switch the left sidebar between the manifest tree, timeline,
 * and AI chat panels, and toggle the right-hand JSON editor. Presentational: all
 * state and toggles come from the {@link EditorWorkspaceController}.
 */
import type { EditorWorkspaceController } from "./use-editor-workspace.ts";

export function LeftActivityBar({ controller }: { controller: EditorWorkspaceController }) {
  const { leftSidebarPanel, setLeftSidebarPanel, rightSidebarPanel, setJsonPanelOpen, openJsonSidebar, selectedNode, checkCounts } =
    controller;
  // Non-info problem count for the «Проверки» activity-bar badge (§9.6): errors +
  // warnings are the actionable ones; a zero count shows no badge.
  const checkBadgeCount = checkCounts.error + checkCounts.warning;

  return (
    <nav className="left-activity-bar" aria-label="Editor sidebars">
      <button
        type="button"
        className={leftSidebarPanel === "tree" ? "is-active" : ""}
        aria-pressed={leftSidebarPanel === "tree"}
        aria-label="Tree"
        title="Tree"
        onClick={() => setLeftSidebarPanel((current) => (current === "tree" ? undefined : "tree"))}
      >
        <span aria-hidden="true">Tree</span>
      </button>
      <button
        type="button"
        className={leftSidebarPanel === "timeline" ? "is-active" : ""}
        aria-pressed={leftSidebarPanel === "timeline"}
        aria-label="Timeline"
        title="Timeline"
        onClick={() => setLeftSidebarPanel((current) => (current === "timeline" ? undefined : "timeline"))}
      >
        <span aria-hidden="true">Time</span>
      </button>
      <button
        type="button"
        className={leftSidebarPanel === "chat" ? "is-active" : ""}
        aria-pressed={leftSidebarPanel === "chat"}
        aria-label="AI chat"
        title="AI chat"
        onClick={() => setLeftSidebarPanel((current) => (current === "chat" ? undefined : "chat"))}
      >
        <span aria-hidden="true">AI</span>
      </button>
      <button
        type="button"
        className={leftSidebarPanel === "assets" ? "is-active" : ""}
        aria-pressed={leftSidebarPanel === "assets"}
        aria-label="Ассеты"
        title="Ассеты"
        data-testid="activity-bar-assets"
        onClick={() => setLeftSidebarPanel((current) => (current === "assets" ? undefined : "assets"))}
      >
        <span aria-hidden="true">Ast</span>
      </button>
      <button
        type="button"
        className={`left-activity-bar-checks ${leftSidebarPanel === "checks" ? "is-active" : ""}`}
        aria-pressed={leftSidebarPanel === "checks"}
        aria-label="Проверки"
        title="Проверки"
        data-testid="activity-bar-checks"
        onClick={() => setLeftSidebarPanel((current) => (current === "checks" ? undefined : "checks"))}
      >
        <span aria-hidden="true">Chk</span>
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
        aria-label="JSON"
        title="JSON"
        onClick={() => {
          if (rightSidebarPanel === "json") {
            setJsonPanelOpen(false);
            return;
          }

          openJsonSidebar(selectedNode?.pointer ?? "");
        }}
      >
        <span aria-hidden="true">JSON</span>
      </button>
    </nav>
  );
}
