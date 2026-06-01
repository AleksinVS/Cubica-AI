import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { PluginDiagnosticsJournal } from "./plugin-diagnostics-journal";
import type { RoutedEditorDiagnostic } from "@/lib/editor-web-adapter";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PluginDiagnosticsJournal", () => {
  it("renders plugin diagnostics with source, file path and message", async () => {
    const diagnostic: RoutedEditorDiagnostic = {
      severity: "error",
      source: "plugin-validation",
      pointer: "/dependencies",
      label: "/dependencies",
      message: "dependenciesPolicy=platform-only forbids package.json dependencies",
      range: undefined,
      filePath: "games/antarctica/plugins/antarctica-player/package.json"
    };
    const onSelectDiagnostic = vi.fn<(diagnostic: RoutedEditorDiagnostic) => void>();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | undefined;

    await act(async () => {
      root = createRoot(container);
      root.render(<PluginDiagnosticsJournal diagnostics={[diagnostic]} onSelectDiagnostic={onSelectDiagnostic} />);
    });

    expect(container.querySelector("summary")?.textContent).toBe("Plugins: 1 blocking diagnostic");

    const row = container.querySelector<HTMLButtonElement>("button.plugin-diagnostic-error");
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("plugin-validation");
    expect(row?.textContent).toContain("games/antarctica/plugins/antarctica-player/package.json /dependencies");
    expect(row?.textContent).toContain("dependenciesPolicy=platform-only forbids package.json dependencies");
    expect(row?.title).toContain("plugin-validation games/antarctica/plugins/antarctica-player/package.json /dependencies");

    await act(async () => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSelectDiagnostic).toHaveBeenCalledWith(diagnostic);

    await act(async () => {
      root?.unmount();
    });
    container.remove();
  });
});
