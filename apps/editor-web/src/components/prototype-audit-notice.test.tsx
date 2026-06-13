import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { PrototypeAuditNotice } from "./prototype-audit-notice";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PrototypeAuditNotice", () => {
  it("renders a compact nonblocking audit warning", async () => {
    const onSnooze = vi.fn<() => void>();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | undefined;

    await act(async () => {
      root = createRoot(container);
      root.render(
        <PrototypeAuditNotice
          notice={{
            notification: "partial",
            message: "Weekly prototype audit was partial; LLM semantic status is skipped.",
            lastCompletedAt: "2026-06-08T03:52:00Z",
            llmStatus: "skipped",
            reportPath: ".tmp/prototype-audit/weekly-report.md",
            workflowUrl: "https://example.test/audit",
            summary: {
              deterministicCandidates: 12,
              semanticCandidates: 0,
              promotionCandidates: 2
            }
          }}
          onSnooze={onSnooze}
        />
      );
    });

    expect(container.querySelector("summary")?.textContent).toBe("Prototype audit: partial");
    expect(container.textContent).toContain("Weekly prototype audit was partial");
    expect(container.textContent).toContain("12 deterministic, 0 semantic, 2 promotion");
    expect(container.textContent).toContain(".tmp/prototype-audit/weekly-report.md");
    expect(container.querySelector<HTMLAnchorElement>("a")?.href).toBe("https://example.test/audit");

    const snooze = container.querySelector<HTMLButtonElement>("button");
    await act(async () => {
      snooze?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSnooze).toHaveBeenCalledOnce();

    await act(async () => {
      root?.unmount();
    });
    container.remove();
  });
});
