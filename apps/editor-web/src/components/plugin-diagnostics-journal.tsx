/**
 * Compact editor footer widget for project-local plugin validation.
 *
 * Plugin diagnostics are routed through the same diagnostic model as manifest
 * validation, but authors need a separate status row because these messages
 * often point to plugin files rather than the active authoring JSON document.
 */
import React from "react";

import type { RoutedEditorDiagnostic } from "@/lib/editor-web-adapter";

export function PluginDiagnosticsJournal({
  diagnostics,
  onSelectDiagnostic
}: {
  readonly diagnostics: readonly RoutedEditorDiagnostic[];
  readonly onSelectDiagnostic: (diagnostic: RoutedEditorDiagnostic) => void;
}) {
  const summary = summarizePluginDiagnostics(diagnostics);

  return (
    <details className={`plugin-diagnostics-journal ${diagnostics.length === 0 ? "is-passed" : "is-blocked"}`}>
      <summary>{summary}</summary>
      {diagnostics.length > 0 ? (
        <div className="plugin-diagnostics-list" role="list">
          {diagnostics.slice(0, 5).map((diagnostic, index) => (
            <button
              className={`plugin-diagnostic plugin-diagnostic-${diagnostic.severity}`}
              key={`${diagnostic.source}-${diagnostic.filePath ?? ""}-${diagnostic.pointer}-${diagnostic.message}-${index}`}
              type="button"
              onClick={() => onSelectDiagnostic(diagnostic)}
              role="listitem"
              title={`${diagnostic.source} ${formatDiagnosticLocation(diagnostic)}: ${diagnostic.message}`}
            >
              <span>{diagnostic.source}</span>
              <strong>{formatDiagnosticLocation(diagnostic)}</strong>
              {diagnostic.message}
            </button>
          ))}
          {diagnostics.length > 5 ? (
            <span className="plugin-diagnostic-overflow">+{diagnostics.length - 5} more</span>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

export function summarizePluginDiagnostics(diagnostics: readonly RoutedEditorDiagnostic[]): string {
  if (diagnostics.length === 0) {
    return "Plugins: passed";
  }

  const blockingCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  if (blockingCount > 0) {
    return `Plugins: ${blockingCount} blocking diagnostic${blockingCount === 1 ? "" : "s"}`;
  }

  return `Plugins: ${diagnostics.length} warning${diagnostics.length === 1 ? "" : "s"}`;
}

function formatDiagnosticLocation(diagnostic: RoutedEditorDiagnostic): string {
  const pointer = diagnostic.label || diagnostic.pointer || "/";
  return diagnostic.filePath === undefined ? pointer : `${diagnostic.filePath} ${pointer}`;
}
