import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { CubicaSurface, CubicaSurfaceAction } from "@cubica/contracts-ai";

import { EditorCubicaSurfaceRenderer } from "./editor-cubica-surface";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const editorSurface: CubicaSurface = {
  schemaVersion: "1.0.0",
  surfaceId: "editor-surface-test",
  catalogVersion: "2026-06-11",
  mode: "helper",
  title: "Assistant surface",
  root: {
    id: "root",
    kind: "cubica.approvalCard",
    props: {
      title: "Review ChangeSet",
      summary: "Dry-run passed."
    },
    children: [
      {
        id: "diff",
        kind: "cubica.diffSummary",
        props: {
          entries: ["Changed /root/title"]
        }
      },
      {
        id: "diagnostics",
        kind: "cubica.diagnosticList",
        props: {
          items: ["schema /root: valid"]
        }
      },
      {
        id: "apply",
        kind: "cubica.button",
        props: {
          label: "Apply"
        },
        actions: [
          {
            id: "apply-action",
            kind: "editorTool",
            label: "Apply",
            target: "editor.applyChangeSet",
            sideEffectPolicy: "human-approved",
            requiresApproval: true
          }
        ]
      }
    ]
  }
};

describe("EditorCubicaSurfaceRenderer", () => {
  it("renders bounded Surface data and dispatches actions only on click", async () => {
    const onAction = vi.fn<(action: CubicaSurfaceAction) => void>();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | undefined;

    await act(async () => {
      root = createRoot(container);
      root.render(<EditorCubicaSurfaceRenderer surface={editorSurface} onAction={onAction} />);
    });

    expect(container.textContent).toContain("Changed /root/title");
    expect(container.textContent).toContain("schema /root: valid");
    expect(onAction).not.toHaveBeenCalled();

    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toBe("Apply");

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "apply-action",
        target: "editor.applyChangeSet"
      })
    );

    await act(async () => {
      root?.unmount();
    });
    container.remove();
  });
});
