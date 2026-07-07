/**
 * «Проверки» (Checks) sidebar panel (design-spec §3.5; editor-preview-first-ux
 * §9.6; ADR-057 §4.12; mockup card «Вкладка "Проверки"»).
 *
 * Lists every diagnostic the editor collects, grouped by severity, as the
 * author-facing "problems" surface. Each row shows the severity, a plain-language
 * message, the entity `_label` it points at, and a facet/source badge (mockup:
 * «смысл» / «сценарий»). Clicking a row navigates diagnostic → entity → field
 * (§9.6). Deterministic diagnostics also offer a prepared quick fix (e.g. «Создать
 * вид»); every row offers «Исправить агентом», which sends the diagnostic to the
 * agent as an intent through the existing queue.
 *
 * Purely presentational: the grouped rows and the callbacks come from the
 * {@link EditorWorkspaceController}. An empty list renders the «Нет проблем» state.
 */
import React from "react";

import { checkSeverityLabel, type WorkspaceCheckGroup, type WorkspaceCheckItem } from "./checks-helpers.ts";

/** Leading glyph per severity, mirroring the status strip's diagnostic styling. */
const SEVERITY_GLYPH: Readonly<Record<WorkspaceCheckItem["severity"], string>> = {
  error: "✕",
  warning: "⚠",
  info: "ℹ"
};

export function ChecksSidebarPanel({
  groups,
  onNavigate,
  onQuickFix,
  onFixWithAgent,
  onCollapse
}: {
  readonly groups: readonly WorkspaceCheckGroup[];
  readonly onNavigate: (item: WorkspaceCheckItem) => void;
  readonly onQuickFix: (item: WorkspaceCheckItem) => void;
  readonly onFixWithAgent: (item: WorkspaceCheckItem) => void;
  readonly onCollapse: () => void;
}) {
  const isEmpty = groups.length === 0;

  return (
    <>
      <div className="panel-heading">
        <strong>Проверки</strong>
        <button type="button" onClick={onCollapse} aria-label="Collapse checks panel">
          Collapse
        </button>
      </div>
      <div className="checks-body" data-testid="checks-panel">
        {isEmpty ? (
          <p className="checks-empty" data-testid="checks-empty">
            Нет проблем
          </p>
        ) : (
          groups.map((group) => (
            <section
              key={group.severity}
              className={`checks-group checks-group-${group.severity}`}
              data-testid={`checks-group-${group.severity}`}
              aria-label={checkSeverityLabel(group.severity)}
            >
              <div className="checks-group-heading">
                {checkSeverityLabel(group.severity)} <span>{group.items.length}</span>
              </div>
              <ul className="checks-list">
                {group.items.map((item) => (
                  <li
                    key={item.id}
                    className={`checks-item checks-item-${item.severity}`}
                    data-testid="checks-item"
                    data-severity={item.severity}
                    data-code={item.code ?? ""}
                  >
                    <button
                      type="button"
                      className="checks-item-main"
                      data-testid="checks-item-navigate"
                      onClick={() => onNavigate(item)}
                      title={`${item.source}${item.code !== undefined ? ` · ${item.code}` : ""}`}
                    >
                      <span className="checks-item-severity" aria-hidden="true">
                        {SEVERITY_GLYPH[item.severity]}
                      </span>
                      <span className="checks-item-message">{item.message}</span>
                      {item.entityLabel !== undefined ? (
                        <span className="checks-item-label">{item.entityLabel}</span>
                      ) : null}
                      <span className="checks-item-badge">{item.badge}</span>
                    </button>
                    <div className="checks-item-actions">
                      {item.quickFix === "create-view" ? (
                        <button
                          type="button"
                          className="checks-item-fix"
                          data-testid="checks-item-quickfix"
                          onClick={() => onQuickFix(item)}
                        >
                          Создать вид
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="checks-item-agent"
                        data-testid="checks-item-agent"
                        onClick={() => onFixWithAgent(item)}
                      >
                        Исправить агентом
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  );
}
